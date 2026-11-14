/**
 * Where the end-to-end tests point. With no address they build and serve
 * their own copies of the site. With `SPHERE_URL` set they run against a site
 * that is already being served, which is how a deployment gets checked.
 */
export interface LiveTarget {
  /** The site's origin, without a trailing slash. */
  readonly baseURL: string;
  /** True when the address is this machine, where plain HTTP is expected. */
  readonly loopback: boolean;
}

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

// The value is never echoed back: an address can carry credentials.
const refuse = (reason: string): never => {
  throw new Error(`SPHERE_URL ${reason}. Expected an origin such as https://sphere.example`);
};

export function liveTarget(address: string | undefined): LiveTarget | null {
  if (address === undefined) return null;

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return refuse('is not a URL');
  }

  if (url.username !== '' || url.password !== '') return refuse('must not carry credentials');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return refuse('must be an origin, with no path, query or fragment');
  }

  const loopback = LOOPBACK_HOSTS.includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    return refuse('must use https, or http on this machine');
  }

  return { baseURL: url.origin, loopback };
}
