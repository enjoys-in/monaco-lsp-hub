import * as monaco from 'monaco-editor';
import { capabilities, ExecuteCommandRegistrationOptions } from '../types';
import { Disposable, DisposableStore } from '../utils';
import { LspConnection } from '../LspConnection';

/**
 * Makes server commands actually run.
 *
 * Code lenses, command-style code actions and completion items all reference
 * commands *by id*. Monaco will only invoke ids present in its own command
 * registry, so without this every lens click and every command-based action was
 * a no-op — the id was handed over and quietly discarded. Each command the
 * server advertises gets registered here and forwarded to
 * `workspace/executeCommand`.
 */
export class LspExecuteCommandFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            workspace: {
                executeCommand: {
                    dynamicRegistration: true,
                },
            },
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(
            capabilities.workspaceExecuteCommand,
            true,
            (capability: ExecuteCommandRegistrationOptions) => {
                const store = new DisposableStore();
                const registerCommand = (monaco.editor as unknown as {
                    registerCommand?: (
                        id: string,
                        handler: (accessor: unknown, ...args: unknown[]) => void
                    ) => monaco.IDisposable;
                }).registerCommand;

                if (typeof registerCommand !== 'function') {
                    console.warn('[LSP] monaco.editor.registerCommand unavailable — server commands cannot be executed');
                    return store;
                }

                for (const command of capability.commands ?? []) {
                    store.add(registerCommand(command, (_accessor, ...args) => {
                        void this.executeCommand(command, args);
                    }));
                }
                return store;
            }
        ));
    }

    /** Run a server command; returns whatever the server answers. */
    public async executeCommand(command: string, args: unknown[] = []): Promise<unknown> {
        try {
            return await this._connection.server.workspaceExecuteCommand({
                command,
                arguments: args as never,
            });
        } catch (err) {
            console.error(`[LSP] workspace/executeCommand failed for ${command}:`, err);
            return undefined;
        }
    }
}
