export function stableStringify (value) {
  return JSON.stringify(sortKeys(value))
}

function sortKeys (value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }

  if (value == null || typeof value !== 'object') {
    return value
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (value[key] !== undefined) {
        result[key] = sortKeys(value[key])
      }

      return result
    }, {})
}
