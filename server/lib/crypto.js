import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

// Base58 alphabet (excludes 0, O, I, l to avoid confusion)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export async function generateSecret() {
    // Generate 12 characters using cryptographically secure random bytes
    // 12 chars of base58 gives ~69 bits of entropy (log2(58^12) ≈ 69.4)
    // This is more than sufficient for security while being much shorter than UUIDs (36 chars)
    const length = 12;
    let result = '';
    
    for (let i = 0; i < length; i++) {
        // Generate random bytes until we get one that maps evenly to base58
        // This avoids modulo bias
        let byte;
        do {
            byte = randomBytes(1)[0];
        } while (byte >= 256 - (256 % BASE58_ALPHABET.length));
        
        result += BASE58_ALPHABET[byte % BASE58_ALPHABET.length];
    }
    
    return result;
}

export async function hashSecret(secret, saltRounds = 10) {
    const salt = await bcrypt.genSalt(saltRounds);
    const hash = await bcrypt.hash(secret, salt);
    return { hash, salt };
}

export async function verifySecret(secret, hash) {
    return bcrypt.compare(secret, hash);
}


