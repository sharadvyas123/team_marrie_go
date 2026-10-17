import { spawn } from 'node:child_process';

const MAX_INTERVAL_SECONDS = 86_400;
const DEFAULT_INTERVAL_SECONDS = 3_600;

export function parseSchedulerCommand(raw) {
  if (raw === undefined || raw.trim() === '') return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`SCHEDULER_COMMAND must be a JSON array of strings: ${error.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== 'string' || part.length === 0)) {
    throw new Error('SCHEDULER_COMMAND must be a non-empty JSON array of non-empty strings.');
  }

  return parsed;
}

function integerEnvironment(name, fallback, { min, max }) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function booleanEnvironment(name, fallback) {
  const value = String(process.env[name] ?? fallback).toLowerCase();
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false.`);
  return value === 'true';
}

function runOnce(command, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      env: process.env,
      stdio: 'inherit'
    });
    activeChild = child;
    let finished = false;
    let timeout;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      activeChild = null;
      clearTimeout(timeout);
      resolve(result);
    };

    timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      finish({ ok: false, reason: `exceeded ${timeoutMs / 1000}s` });
    }, timeoutMs);

    child.once('error', (error) => finish({ ok: false, reason: error.message }));
    child.once('exit', (code, signal) => {
      finish(code === 0
        ? { ok: true }
        : { ok: false, reason: signal ? `signal ${signal}` : `exit ${code}` });
    });
  });
}

const command = parseSchedulerCommand(process.env.SCHEDULER_COMMAND);
const intervalSeconds = integerEnvironment('SCHEDULER_INTERVAL_SECONDS', DEFAULT_INTERVAL_SECONDS, {
  min: 1,
  max: MAX_INTERVAL_SECONDS
});
const maxRuntimeSeconds = integerEnvironment('SCHEDULER_MAX_RUNTIME_SECONDS', 900, {
  min: 1,
  max: MAX_INTERVAL_SECONDS
});
const runOnStart = booleanEnvironment('SCHEDULER_RUN_ON_START', false);
let stopping = false;
let activeChild = null;
let timer = null;

function stop(reason) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  if (activeChild) activeChild.kill('SIGTERM');
  process.stdout.write(`Scheduler stopped (${reason}).\n`);
  process.exitCode = 0;
}

process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));

async function scheduleNext() {
  if (stopping) return;
  if (!command) {
    process.stdout.write(`Scheduler heartbeat; no SCHEDULER_COMMAND configured. Next run in ${intervalSeconds}s.\n`);
  } else {
    process.stdout.write(`Scheduler running configured task; next run in ${intervalSeconds}s.\n`);
    const result = await runOnce(command, maxRuntimeSeconds * 1_000);
    if (!result.ok) process.stderr.write(`Scheduled task failed: ${result.reason}.\n`);
  }

  if (!stopping) timer = setTimeout(scheduleNext, intervalSeconds * 1_000);
}

process.stdout.write(command
  ? 'Scheduler started with an argument-safe JSON command.\n'
  : 'Scheduler started without a configured task; operational heartbeat mode is active.\n');

if (runOnStart) await scheduleNext();
else timer = setTimeout(scheduleNext, intervalSeconds * 1_000);
