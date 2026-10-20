import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
export function handleRatesRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
export function ratesProxyPlugin(): Plugin;
