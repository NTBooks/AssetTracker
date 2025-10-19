import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export async function generateSecret() {
    return randomUUID();
}

export async function hashSecret(secret, saltRounds = 10) {
    const salt = await bcrypt.genSalt(saltRounds);
    const hash = await bcrypt.hash(secret, salt);
    return { hash, salt };
}

export async function verifySecret(secret, hash) {
    return bcrypt.compare(secret, hash);
}


