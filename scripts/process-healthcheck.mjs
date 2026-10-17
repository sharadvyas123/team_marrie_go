const service = process.argv[2] ?? 'process';

if (!/^[a-z][a-z0-9-]{0,31}$/.test(service)) {
  throw new Error('The service name must contain only lowercase letters, digits, and hyphens.');
}

try {
  process.kill(1, 0);
} catch (error) {
  throw new Error(`${service} PID 1 is not running: ${error.message}`);
}

process.stdout.write(`${service} process is alive.\n`);
