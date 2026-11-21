/**
 * Every sentence the page shows, in English. The other languages are checked
 * against this one: same keys, same parameters.
 */
export const en = {
  page: {
    lede: 'Set up an IQOS ILUMA from this page over Bluetooth. No account, no app, and nothing leaves your browser.',
  },
  error: {
    transport: 'transport error: {{detail}}',
  },
} as const;

type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
/** A dictionary: the keys of the English one, with any text. */
export type Messages = Shape<typeof en>;

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
/** The dotted path to one message, such as `page.lede`. */
export type MessageKey = Paths<typeof en>;
