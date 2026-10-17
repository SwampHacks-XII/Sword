// Explicit opt-in: reuse the game API suite against a temporary Tiger Data
// schema. It never uses or deletes public player/match records.
process.env.GAME_TEST_DATABASE = '1';
await import('./game.test.js');
