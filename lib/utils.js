const readline = require('node:readline');

/**
 * Prompt user for input in the console.
 * @param {String} query 
 * @returns 
 */
const getuserInput = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

/**
 * parse E6 format to regular number
 * @param {Number} e6 
 * @returns 
 */
const parseE6 = (e6) => e6 / 1000000;

module.exports = {
    getuserInput,
    parseE6
};