// Words and colours for finishing positions (pure, so they can be tested).

const ORDINALS = ['1st', '2nd', '3rd', '4th'];
export const ordinal = (position) => ORDINALS[position - 1] ?? `${position}th`;

// Gold, silver, bronze and a plain grey for the rest.
const MEDALS = [0xffd54f, 0xcfd8dc, 0xcd7f32, 0x78909c];
export const medalColor = (position) => MEDALS[position - 1] ?? MEDALS[3];
