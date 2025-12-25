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

module.exports = {
    getuserInput,
};