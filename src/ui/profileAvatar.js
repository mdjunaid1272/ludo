import { AVATAR_KEYS } from '../config/assets.js';
import { assignAvatars } from '../game/avatars.js';

// The picture shown for a player's profile: always the same one for the same name (the pictures in a game are drawn at random
// per game; this one is only the profile's face). Undefined when there are no pictures.
export const avatarForName = (name, keys = AVATAR_KEYS) => assignAvatars(['red'], name, keys).red;
