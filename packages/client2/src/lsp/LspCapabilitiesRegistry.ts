import { TypedChannel } from '@hediet/json-rpc';
import { ClientCapabilities, Capability, ServerCapabilities, api, capabilities, TextDocumentChangeRegistrationOptions, TextDocumentSyncKind } from './types';
import { IDisposable, Disposable } from './utils';

export interface ILspCapabilitiesRegistry {
    addStaticClientCapabilities(capability: ClientCapabilities): IDisposable;
    registerCapabilityHandler<T>(capability: Capability<T>, handleStaticCapability: boolean, handler: (capability: T) => IDisposable): IDisposable;
}

export class LspCapabilitiesRegistry extends Disposable implements ILspCapabilitiesRegistry {
    private readonly _staticCapabilities = new Set<{ cap: ClientCapabilities; }>();
    private readonly _dynamicFromStatic = DynamicFromStaticOptions.create();
    private readonly _registrations = new Map<Capability<any>, CapabilityInfo<any>>();
    private _serverCapabilities: ServerCapabilities | undefined = undefined;

    constructor(
        private readonly _connection: TypedChannel
    ) {
        super();

        this._register(this._connection.registerRequestHandler(api.client.clientRegisterCapability, async (params) => {
            for (const registration of params.registrations) {
                // Servers dynamically register methods this client has no
                // feature for (workspace/didChangeWatchedFiles and friends).
                // Throwing here rejected the whole batch and silently dropped
                // every *supported* registration that came after it.
                const capability = findCapabilityByMethod(registration.method);
                if (!capability) {
                    console.debug(`[LSP] Ignoring dynamic registration for unsupported method ${registration.method}`);
                    continue;
                }
                try {
                    const r = new CapabilityRegistration(registration.id, capability, registration.registerOptions, false);
                    this._registerCapabilityOptions(r);
                } catch (err) {
                    console.warn(`[LSP] Failed to register ${registration.method} (${registration.id}):`, err);
                }
            }
            return { ok: null };
        }));

        this._register(this._connection.registerRequestHandler(api.client.clientUnregisterCapability, async (params) => {
            for (const unregistration of params.unregisterations) {
                const capability = findCapabilityByMethod(unregistration.method);
                if (!capability) {
                    continue;
                }
                const info = this._registrations.get(capability);
                const handlerInfo = info?.registrations.get(unregistration.id);
                if (!handlerInfo) {
                    // Nothing to tear down — unregistering something we never
                    // registered is not worth failing the request over.
                    console.debug(`[LSP] No registration for ${unregistration.method} with id ${unregistration.id}`);
                    continue;
                }
                handlerInfo.handlerDisposables.forEach(d => d.dispose());
                handlerInfo.handlerDisposables.clear();
                info?.registrations.delete(unregistration.id);
            }
            return { ok: null };
        }));
    }

    private _registerCapabilityOptions<T>(registration: CapabilityRegistration<T>) {
        let registrationForMethod = this._registrations.get(registration.capability);
        if (!registrationForMethod) {
            registrationForMethod = new CapabilityInfo();
            this._registrations.set(registration.capability, registrationForMethod);
        }
        if (registrationForMethod.registrations.has(registration.id)) {
            throw new Error(`Handler for method ${registration.capability.method} with id ${registration.id} already registered`);
        }
        registrationForMethod.registrations.set(registration.id, registration);
        for (const h of registrationForMethod.handlers) {
            if (!h.handleStaticCapability && registration.isFromStatic) {
                continue;
            }
            registration.handlerDisposables.set(h, h.handler(registration.options));
        }
    }

    setServerCapabilities(serverCapabilities: ServerCapabilities) {
        if (this._serverCapabilities) {
            console.warn('[LSP] Server capabilities already set — ignoring second initialize result');
            return;
        }
        this._serverCapabilities = serverCapabilities;
        for (const cap of Object.values(capabilities)) {
            const options = this._dynamicFromStatic.getOptions(cap, serverCapabilities);
            if (options) {
                this._registerCapabilityOptions(new CapabilityRegistration(cap.method, cap, options, true));
            }
        }
    }

    getClientCapabilities(): ClientCapabilities {
        const result: ClientCapabilities = {};
        for (const c of this._staticCapabilities) {
            deepAssign(result, c.cap);
        }
        return result;
    }

    /** True once the server has answered `initialize`. */
    get hasServerCapabilities(): boolean {
        return this._serverCapabilities !== undefined;
    }

    addStaticClientCapabilities(capability: ClientCapabilities): IDisposable {
        const obj = { cap: capability };
        this._staticCapabilities.add(obj);
        return {
            dispose: () => {
                this._staticCapabilities.delete(obj);
            }
        };
    }

    registerCapabilityHandler<T>(capability: Capability<T>, handleStaticCapability: boolean, handler: (capability: T) => IDisposable): IDisposable {
        let info = this._registrations.get(capability);
        if (!info) {
            info = new CapabilityInfo();
            this._registrations.set(capability, info);
        }
        const handlerInfo = new CapabilityHandler(capability, handleStaticCapability, handler);
        info.handlers.add(handlerInfo);

        for (const registration of info.registrations.values()) {
            if (!handlerInfo.handleStaticCapability && registration.isFromStatic) {
                continue;
            }
            registration.handlerDisposables.set(handlerInfo, handler(registration.options));
        }

        return {
            dispose: () => {
                info.handlers.delete(handlerInfo);
                for (const registration of info.registrations.values()) {
                    const disposable = registration.handlerDisposables.get(handlerInfo);
                    if (disposable) {
                        disposable.dispose();
                        registration.handlerDisposables.delete(handlerInfo);
                    }
                }
            }
        };
    }
}

class CapabilityHandler<T> {
    constructor(
        public readonly capability: Capability<T>,
        public readonly handleStaticCapability: boolean,
        public readonly handler: (capabilityOptions: T) => IDisposable
    ) { }
}

class CapabilityRegistration<T> {
    public readonly handlerDisposables = new Map<CapabilityHandler<any>, IDisposable>();

    constructor(
        public readonly id: string,
        public readonly capability: Capability<T>,
        public readonly options: T,
        public readonly isFromStatic: boolean
    ) { }
}

const capabilitiesByMethod = new Map([...Object.values(capabilities)].map(c => [c.method, c]));
function findCapabilityByMethod(method: string): Capability<any> | undefined {
    return capabilitiesByMethod.get(method);
}

class CapabilityInfo<T> {
    public readonly handlers = new Set<CapabilityHandler<T>>();
    public readonly registrations = new Map</* id */ string, CapabilityRegistration<T>>();
}

class DynamicFromStaticOptions {
    private readonly _mappings = new Map</* method */ string, (serverCapabilities: ServerCapabilities) => any>();

    public static create(): DynamicFromStaticOptions {
        const o = new DynamicFromStaticOptions();
        o.set(capabilities.textDocumentDidChange, s => {
            // Document sync drives didOpen/didChange/didClose, so it must never
            // resolve to "not registered": a server that omits textDocumentSync
            // would otherwise never receive a single document and every feature
            // would silently answer nothing. Full sync is the safe default.
            if (s.textDocumentSync === undefined) {
                return {
                    syncKind: TextDocumentSyncKind.Full,
                    documentSelector: null,
                } satisfies TextDocumentChangeRegistrationOptions;
            }
            if (typeof s.textDocumentSync === 'object') {
                return {
                    syncKind: s.textDocumentSync.change ?? TextDocumentSyncKind.Full,
                    documentSelector: null,
                } satisfies TextDocumentChangeRegistrationOptions;
            }
            return {
                syncKind: s.textDocumentSync,
                documentSelector: null,
            } satisfies TextDocumentChangeRegistrationOptions;
        });

        o.set(capabilities.textDocumentCompletion, s => s.completionProvider);
        o.set(capabilities.textDocumentHover, s => s.hoverProvider);
        o.set(capabilities.textDocumentSignatureHelp, s => s.signatureHelpProvider);
        o.set(capabilities.textDocumentDefinition, s => s.definitionProvider);
        o.set(capabilities.textDocumentReferences, s => s.referencesProvider);
        o.set(capabilities.textDocumentDocumentHighlight, s => s.documentHighlightProvider);
        o.set(capabilities.textDocumentDocumentSymbol, s => s.documentSymbolProvider);
        o.set(capabilities.textDocumentCodeAction, s => s.codeActionProvider);
        o.set(capabilities.textDocumentCodeLens, s => s.codeLensProvider);
        o.set(capabilities.textDocumentDocumentLink, s => s.documentLinkProvider);
        o.set(capabilities.textDocumentFormatting, s => s.documentFormattingProvider);
        o.set(capabilities.textDocumentRangeFormatting, s => s.documentRangeFormattingProvider);
        o.set(capabilities.textDocumentOnTypeFormatting, s => s.documentOnTypeFormattingProvider);
        o.set(capabilities.textDocumentRename, s => s.renameProvider);
        o.set(capabilities.textDocumentFoldingRange, s => s.foldingRangeProvider);
        o.set(capabilities.textDocumentDeclaration, s => s.declarationProvider);
        o.set(capabilities.textDocumentTypeDefinition, s => s.typeDefinitionProvider);
        o.set(capabilities.textDocumentImplementation, s => s.implementationProvider);
        o.set(capabilities.textDocumentDocumentColor, s => s.colorProvider);
        o.set(capabilities.textDocumentSelectionRange, s => s.selectionRangeProvider);
        o.set(capabilities.textDocumentLinkedEditingRange, s => s.linkedEditingRangeProvider);
        o.set(capabilities.textDocumentPrepareCallHierarchy, s => s.callHierarchyProvider);
        o.set(capabilities.textDocumentSemanticTokensFull, s => s.semanticTokensProvider);
        o.set(capabilities.textDocumentInlayHint, s => s.inlayHintProvider);
        o.set(capabilities.textDocumentInlineValue, s => s.inlineValueProvider);
        o.set(capabilities.textDocumentDiagnostic, s => s.diagnosticProvider);
        o.set(capabilities.textDocumentMoniker, s => s.monikerProvider);
        o.set(capabilities.textDocumentPrepareTypeHierarchy, s => s.typeHierarchyProvider);
        o.set(capabilities.workspaceSymbol, s => s.workspaceSymbolProvider);
        o.set(capabilities.workspaceExecuteCommand, s => s.executeCommandProvider);
        return o;
    }

    set<T>(capability: Capability<T>, getOptionsFromStatic: (serverCapabilities: ServerCapabilities) => T | boolean | undefined): void {
        if (this._mappings.has(capability.method)) {
            throw new Error(`Capability for method ${capability.method} already registered`);
        }
        this._mappings.set(capability.method, getOptionsFromStatic);
    }

    getOptions<T>(capability: Capability<T>, serverCapabilities: ServerCapabilities): T | undefined {
        const getter = this._mappings.get(capability.method);
        if (!getter) {
            return undefined;
        }
        const result = getter(serverCapabilities);
        return result;
    }
}

/**
 * Merge `source` into `target`, copying rather than aliasing.
 *
 * Assigning the source object by reference meant a later merge over the same
 * key path wrote *into* a feature's registered capability object, so the
 * declared capabilities drifted as more features were added.
 */
function deepAssign(target: any, source: any) {
    for (const key of Object.keys(source)) {
        const srcValue = source[key];
        if (srcValue === undefined) {
            continue;
        }

        if (typeof srcValue !== 'object' || srcValue === null) {
            target[key] = srcValue;
            continue;
        }
        if (Array.isArray(srcValue)) {
            target[key] = srcValue.slice();
            continue;
        }

        const tgtValue = target[key];
        if (typeof tgtValue !== 'object' || tgtValue === null || Array.isArray(tgtValue)) {
            target[key] = {};
        }
        deepAssign(target[key], srcValue);
    }
}
