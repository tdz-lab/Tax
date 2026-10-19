import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

if (!(globalThis as any).crypto?.subtle) (globalThis as any).crypto = webcrypto;
