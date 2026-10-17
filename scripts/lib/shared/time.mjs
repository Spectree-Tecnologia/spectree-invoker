/** A UTC timestamp to the second: the shape every recorded document uses (`spectree/common#timestamp`). */
export const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
