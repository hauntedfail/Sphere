import type { ConfigEnv, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

/** Resolve the Vite config the way `vite <command> --mode <mode>` would. */
function resolve(command: ConfigEnv['command'], mode: string): UserConfig {
  if (typeof config !== 'function') throw new Error('vite.config.ts must export a function');
  return config({ command, mode }) as UserConfig;
}

const simulator = (command: ConfigEnv['command'], mode: string): unknown =>
  resolve(command, mode).define?.['__SIMULATOR__'];

describe('which builds carry the simulator', () => {
  it('leaves it out of the production build', () => {
    expect(simulator('build', 'production')).toBe('false');
    expect(resolve('build', 'production').build?.outDir).toBe('dist');
  });

  it('puts it in the debug build, in a directory of its own', () => {
    expect(simulator('build', 'debug')).toBe('true');
    expect(resolve('build', 'debug').build?.outDir).toBe('dist-debug');
  });

  it('puts it in the dev server', () => {
    expect(simulator('serve', 'development')).toBe('true');
  });

  it('leaves it out of a build in any mode it does not know', () => {
    for (const mode of ['development', 'staging', 'prod', 'test', 'Debug', '']) {
      expect(simulator('build', mode), mode).toBe('false');
      expect(resolve('build', mode).build?.outDir, mode).toBe('dist');
    }
  });
});
