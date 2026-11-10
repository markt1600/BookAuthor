// Which optional content packs this build includes.
//
// PrivateBooks ships the adult pack (lib/adult.js); BookAuthor does not, and
// runs on the mild baseline in lib/maturity.js. This line is the only
// difference: there it reads `export { default as adult } from "./adult.js";`
export const adult = null;
