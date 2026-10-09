export interface LookupAddress {
  address: string
  family: number
}

/** Call Node's lookup callback using the overload requested by `options.all`. */
export function invokeLookupCallback(
  callback: (...args: any[]) => void,
  all: boolean,
  error: NodeJS.ErrnoException | null,
  addresses: LookupAddress[],
): void {
  if (error) {
    if (all) callback(error, [])
    else callback(error, '', 0)
    return
  }

  if (all) {
    callback(null, addresses)
    return
  }

  const first = addresses[0]
  if (first) callback(null, first.address, first.family)
  else callback(Object.assign(new Error('No address records'), { code: 'ENOTFOUND' }), '', 0)
}