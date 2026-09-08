import { TypedChannel } from '@hediet/json-rpc';
import { api } from './types';
import { ITextModelBridge } from './ITextModelBridge';
import { LspCapabilitiesRegistry } from './LspCapabilitiesRegistry';
import { LspDiagnosticStore } from './LspDiagnosticStore';

export class LspConnection {
    constructor(
        public readonly server: typeof api.TServerInterface,
        public readonly bridge: ITextModelBridge,
        public readonly capabilities: LspCapabilitiesRegistry,
        public readonly connection: TypedChannel,
        /** Originals for the diagnostics currently shown, shared across features */
        public readonly diagnostics: LspDiagnosticStore = new LspDiagnosticStore(),
    ) { }
}
