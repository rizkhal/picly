// Minimal probe: does Electron itself start and print?
console.log('hello from electron main (pid ok)');
setTimeout(() => process.exit(0), 500);
