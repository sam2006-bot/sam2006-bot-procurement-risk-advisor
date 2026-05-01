function countCjk(value) {
  return (String(value || '').match(/[\u3400-\u9fff]/g) || []).length;
}

function decodeUploadFileName(fileName) {
  const original = String(fileName || '');
  const decoded = Buffer.from(original, 'latin1').toString('utf8');

  if (!decoded || decoded.includes('\uFFFD')) return original;
  if (countCjk(decoded) > countCjk(original)) return decoded;
  return original;
}

module.exports = {
  decodeUploadFileName
};
