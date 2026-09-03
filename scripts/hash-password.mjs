import crypto from 'node:crypto';

const pw = process.argv[2];
if (!pw) {
  console.error('用法: node scripts/hash-password.mjs "你的密码"');
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(pw, salt, 64);
console.log(`scrypt:${salt.toString('hex')}:${hash.toString('hex')}`);
