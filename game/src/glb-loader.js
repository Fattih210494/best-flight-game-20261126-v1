// Minimal GLB (glTF 2.0 binary) loader, written for this entry's biplane.
// Scope: uncompressed buffers, TRIANGLES primitives, POSITION / NORMAL /
// TEXCOORD_0 attributes, embedded JPEG/PNG textures, node TRS or matrix,
// KHR_materials_pbrSpecularGlossiness (converted approximately to a
// metal-rough material). No skins, no animations, no Draco/meshopt — this
// model has none of those. Textures are decoded by the browser from Blob
// URLs, so no image-codec code is needed here.
import * as THREE from 'three';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const COMP_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const TYPE_ARRAY = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const TYPE_MAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295, 5126: 1 };

// Read one accessor into a fresh typed array, honouring byteStride and
// the normalized flag. Float attributes come back as Float32Array.
function readAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  if (acc.sparse) throw new Error('sparse accessors are not supported');
  const view = gltf.bufferViews[acc.bufferView];
  const compBytes = COMP_BYTES[acc.componentType];
  const itemSize = TYPE_SIZE[acc.type];
  const elemBytes = compBytes * itemSize;
  const stride = view.byteStride || elemBytes;
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const Raw = TYPE_ARRAY[acc.componentType];
  const count = acc.count;
  if (stride === elemBytes) {
    const raw = new Raw(bin.buffer, bin.byteOffset + base, count * itemSize);
    if (acc.componentType === 5126 || !acc.normalized) return raw;
    const out = new Float32Array(count * itemSize);
    const max = TYPE_MAX[acc.componentType];
    for (let i = 0; i < out.length; i++) out[i] = Math.max(raw[i] / max, -1);
    return out;
  }
  // Strided (interleaved) data: copy element by element.
  const out = acc.componentType === 5126 ? new Float32Array(count * itemSize) : new Raw(count * itemSize);
  const dv = new DataView(bin.buffer, bin.byteOffset);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < itemSize; c++) {
      const off = base + i * stride + c * compBytes;
      if (acc.componentType === 5126) out[i * itemSize + c] = dv.getFloat32(off, true);
      else if (acc.componentType === 5123) out[i * itemSize + c] = dv.getUint16(off, true);
      else if (acc.componentType === 5125) out[i * itemSize + c] = dv.getUint32(off, true);
      else if (acc.componentType === 5121) out[i * itemSize + c] = dv.getUint8(off);
      else if (acc.componentType === 5120) out[i * itemSize + c] = dv.getInt8(off);
      else out[i * itemSize + c] = dv.getInt16(off, true);
    }
  }
  if (acc.normalized && acc.componentType !== 5126) {
    const max = TYPE_MAX[acc.componentType];
    const f = new Float32Array(out.length);
    for (let i = 0; i < f.length; i++) f[i] = Math.max(out[i] / max, -1);
    return f;
  }
  return out;
}

// glTF attribute name -> three.js attribute name.
const ATTR_NAME = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv' };

function buildGeometry(gltf, bin, prim) {
  const geo = new THREE.BufferGeometry();
  for (const [name, accIndex] of Object.entries(prim.attributes)) {
    const threeName = ATTR_NAME[name];
    if (!threeName) continue;
    const arr = readAccessor(gltf, bin, accIndex);
    const itemSize = TYPE_SIZE[gltf.accessors[accIndex].type];
    geo.setAttribute(threeName, new THREE.BufferAttribute(arr, itemSize));
  }
  if (prim.indices !== undefined) {
    const idx = readAccessor(gltf, bin, prim.indices);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return geo;
}

// Decode one embedded image (bufferView) into a three.js texture.
async function loadTexture(gltf, bin, texIndex) {
  const texDef = gltf.textures[texIndex];
  const imgDef = gltf.images[texDef.source];
  const view = gltf.bufferViews[imgDef.bufferView];
  const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  const url = URL.createObjectURL(new Blob([bytes], { type: imgDef.mimeType || 'image/png' }));
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.flipY = false; // glTF UV origin is top-left
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// One material. The spec-gloss extension wins where present (its diffuse
// values are the real colours; the metal-rough block is only a fallback).
async function buildMaterial(gltf, bin, matIndex, texCache) {
  const def = gltf.materials[matIndex];
  const mat = new THREE.MeshStandardMaterial();
  const sg = def.extensions && def.extensions.KHR_materials_pbrSpecularGlossiness;
  const mr = def.pbrMetallicRoughness || {};
  const texFor = (t) => {
    if (t === undefined) return Promise.resolve(null);
    if (!texCache.has(t)) texCache.set(t, loadTexture(gltf, bin, t));
    return texCache.get(t);
  };
  if (sg) {
    const diffuse = sg.diffuseFactor || [1, 1, 1, 1];
    mat.color.setRGB(diffuse[0], diffuse[1], diffuse[2]);
    mat.opacity = diffuse[3];
    if (sg.diffuseTexture) mat.map = await texFor(sg.diffuseTexture.index);
    const spec = sg.specularFactor || [0.5, 0.5, 0.5];
    const specLum = (spec[0] + spec[1] + spec[2]) / 3;
    mat.metalness = Math.min(specLum, 1) * 0.5;
    mat.roughness = 1 - (sg.glossinessFactor ?? 0.5);
  } else {
    const base = mr.baseColorFactor || [1, 1, 1, 1];
    mat.color.setRGB(base[0], base[1], base[2]);
    mat.opacity = base[3];
    if (mr.baseColorTexture) mat.map = await texFor(mr.baseColorTexture.index);
    mat.metalness = mr.metallicFactor ?? 1;
    mat.roughness = mr.roughnessFactor ?? 1;
  }
  if (def.alphaMode === 'MASK') mat.alphaTest = def.alphaCutoff ?? 0.5;
  if (def.alphaMode === 'BLEND' || mat.opacity < 1) mat.transparent = true;
  if (def.doubleSided) mat.side = THREE.DoubleSide;
  if (def.name) mat.name = def.name;
  return mat;
}

// One node: a Mesh when it carries geometry, otherwise a Group. Children
// attach to the mesh itself, like the reference loader does.
function buildNode(gltf, bin, materials, nodeIndex) {
  const def = gltf.nodes[nodeIndex];
  let obj;
  if (def.mesh !== undefined) {
    const meshDef = gltf.meshes[def.mesh];
    const prim = meshDef.primitives[0];
    obj = new THREE.Mesh(buildGeometry(gltf, bin, prim), materials[prim.material ?? 0]);
    for (let i = 1; i < meshDef.primitives.length; i++) {
      const p = meshDef.primitives[i];
      obj.add(new THREE.Mesh(buildGeometry(gltf, bin, p), materials[p.material ?? 0]));
    }
  } else {
    obj = new THREE.Group();
  }
  obj.name = def.name || '';
  if (def.matrix) {
    new THREE.Matrix4().fromArray(def.matrix).decompose(obj.position, obj.quaternion, obj.scale);
  } else {
    if (def.translation) obj.position.fromArray(def.translation);
    if (def.rotation) obj.quaternion.fromArray(def.rotation);
    if (def.scale) obj.scale.fromArray(def.scale);
  }
  for (const child of def.children || []) obj.add(buildNode(gltf, bin, materials, child));
  return obj;
}

// Load a GLB file and return { scene } — the same shape the code that used
// to call GLTFLoader.loadAsync expects.
export async function loadGLB(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('only glTF 2.0 is supported');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== CHUNK_JSON) throw new Error('GLB has no JSON chunk');
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binOff = 20 + jsonLen;
  const binLen = dv.getUint32(binOff, true);
  if (dv.getUint32(binOff + 4, true) !== CHUNK_BIN) throw new Error('GLB has no BIN chunk');
  const bin = new Uint8Array(buf, binOff + 8, binLen);

  const texCache = new Map();
  const materials = [];
  for (let i = 0; i < (gltf.materials || []).length; i++) {
    materials.push(await buildMaterial(gltf, bin, i, texCache));
  }
  const scene = new THREE.Group();
  scene.name = 'Scene';
  const sceneDef = gltf.scenes[gltf.scene || 0];
  for (const root of sceneDef.nodes || []) scene.add(buildNode(gltf, bin, materials, root));
  return { scene };
}
