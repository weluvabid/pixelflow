import { installWorkerRuntime } from './runtime.ts';

installWorkerRuntime(globalThis as unknown as Parameters<typeof installWorkerRuntime>[0]);
