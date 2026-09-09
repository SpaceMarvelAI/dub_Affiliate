import { randomInt } from "crypto";

const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function randomKey(length = 7) {
  let key = "";
  for (let i = 0; i < length; i++) {
    key += ALPHABET[randomInt(ALPHABET.length)];
  }
  return key;
}
