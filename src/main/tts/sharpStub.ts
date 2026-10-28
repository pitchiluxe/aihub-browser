// transformers.js imports sharp for its image pipelines. The voice never
// touches an image, and sharp is a 20 MB native module — so the worker bundle
// resolves it to this instead. Anything that does reach for it fails loudly.
const sharp = () => { throw new Error('sharp is not bundled with AIHub') }
export default sharp
