import { describe, expect, it } from 'vitest';
import { liveTarget } from '../e2e/target';

describe('liveTarget', () => {
  it('is null when no address is given: the tests build and serve their own copies', () => {
    expect(liveTarget(undefined)).toBeNull();
  });

  it('accepts an HTTPS origin', () => {
    expect(liveTarget('https://sphere.example')).toEqual({
      baseURL: 'https://sphere.example',
      loopback: false,
    });
  });

  it('drops a trailing slash and keeps a port', () => {
    expect(liveTarget('https://sphere.example:8443/')?.baseURL).toBe('https://sphere.example:8443');
  });

  it('accepts plain HTTP on this machine only, for rehearsing against a local server', () => {
    for (const address of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787']) {
      expect(liveTarget(address), address).toMatchObject({ loopback: true });
    }
    expect(liveTarget('https://localhost:8787')).toMatchObject({ loopback: true });
  });

  it('refuses plain HTTP anywhere else', () => {
    expect(() => liveTarget('http://sphere.example')).toThrow(/https/i);
  });

  it('is not fooled by a name that only looks like this machine', () => {
    for (const address of ['http://localhost.evil.example', 'http://localhost.', 'http://127.0.0.2']) {
      expect(() => liveTarget(address), address).toThrow(/https/i);
    }
    expect(liveTarget('HTTP://LOCALHOST:8787')).toMatchObject({ loopback: true });
  });

  it('refuses anything that is not a bare origin', () => {
    for (const address of [
      '',
      'sphere.example',
      'ftp://sphere.example',
      'https://sphere.example/app',
      'https://sphere.example/?x=1',
      'https://sphere.example/#top',
      'https://user:secret@sphere.example',
    ]) {
      expect(() => liveTarget(address), address).toThrow(/SPHERE_URL/);
    }
  });

  it('does not repeat credentials in its error message', () => {
    try {
      liveTarget('https://user:secret@sphere.example');
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
});
