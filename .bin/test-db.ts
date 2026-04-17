import { config } from 'dotenv';
config();
import { KeyResolver } from '../src/utils/KeyResolver';

async function run() {
    // We are now using the correct user_id from your screenshot!
    const keys = await KeyResolver.resolveKeys('2521020e-048c-40fa-aad5-589a31019d25');
    console.log("FINAL RESOLVED KEYS:", keys);
}
run();