'use strict';

// Builds a minimal ICC v2 matrix/TRC profile in memory. It backs the committed
// `src/assets/synthetic.icc` (see `scripts/make-icc.js`) and lets the proof
// parser and transform be tested on any machine, CI included, without vendoring
// a third-party profile. The profile is deliberately, unmistakably synthetic —
// it must never be mistaken for a real working profile such as Adobe RGB (1998).

const Proof = require('./proof');

const D50 = [0.9642, 1.0, 0.8249];

const u32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0, 0);
  return b;
};
const i32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v | 0, 0);
  return b;
};
const s15 = (v) => i32(Math.round(v * 65536));

const xyzType = (x, y, z) => Buffer.concat([Buffer.from('XYZ ', 'latin1'), Buffer.alloc(4), s15(x), s15(y), s15(z)]);

const curvGamma = (g) => {
  const value = Buffer.alloc(2);
  value.writeUInt16BE(Math.round(g * 256), 0);
  return Buffer.concat([Buffer.from('curv', 'latin1'), Buffer.alloc(4), u32(1), value]);
};

const descType = (text) => {
  const ascii = Buffer.from(`${text}\0`, 'latin1');
  return Buffer.concat([
    Buffer.from('desc', 'latin1'), Buffer.alloc(4),
    u32(ascii.length), ascii,
    u32(0), u32(0), // unicode language code + count
    Buffer.alloc(2), Buffer.from([0]), Buffer.alloc(67), // scriptcode
  ]);
};

/**
 * @param {object} [opts]
 * @param {string} [opts.description]
 * @param {number} [opts.gamma]
 * @param {number[3][3]} [opts.colorants] D50-adapted colourant matrix (columns r,g,b)
 * @returns {Buffer} a valid ICC profile
 */
function buildSyntheticIcc(opts = {}) {
  const description = opts.description || 'Synthetic sRGB (test)';
  const gamma = opts.gamma || 2.2;
  const P = opts.colorants || Proof.mulMat(Proof.BRADFORD_D65_D50, Proof.M_SRGB);

  const tags = [
    ['desc', descType(description)],
    ['wtpt', xyzType(D50[0], D50[1], D50[2])],
    ['rXYZ', xyzType(P[0][0], P[1][0], P[2][0])],
    ['gXYZ', xyzType(P[0][1], P[1][1], P[2][1])],
    ['bXYZ', xyzType(P[0][2], P[1][2], P[2][2])],
    ['rTRC', curvGamma(gamma)],
    ['gTRC', curvGamma(gamma)],
    ['bTRC', curvGamma(gamma)],
  ];

  const header = Buffer.alloc(128);
  header.write('lcms', 4, 'latin1');
  header.writeUInt32BE(0x02100000, 8); // v2.1
  header.write('mntr', 12, 'latin1');
  header.write('RGB ', 16, 'latin1');
  header.write('XYZ ', 20, 'latin1');
  header.writeUInt16BE(2024, 24);
  header.writeUInt16BE(1, 26);
  header.writeUInt16BE(1, 28);
  header.write('acsp', 36, 'latin1');
  header.writeInt32BE(Math.round(D50[0] * 65536), 68);
  header.writeInt32BE(Math.round(D50[1] * 65536), 72);
  header.writeInt32BE(Math.round(D50[2] * 65536), 76);

  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const chunks = [];
  const entries = tags.map(([sig, data]) => {
    const entry = { sig, offset, size: data.length };
    chunks.push(data);
    offset += data.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    return entry;
  });

  header.writeUInt32BE(offset, 0); // total size

  const table = Buffer.alloc(tableSize);
  table.writeUInt32BE(entries.length, 0);
  entries.forEach((e, i) => {
    const o = 4 + i * 12;
    table.write(e.sig, o, 'latin1');
    table.writeUInt32BE(e.offset, o + 4);
    table.writeUInt32BE(e.size, o + 8);
  });

  return Buffer.concat([header, table, ...chunks], offset);
}

module.exports = { buildSyntheticIcc };
