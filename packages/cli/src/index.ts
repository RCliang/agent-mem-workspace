#!/usr/bin/env node
import { run } from './run.js';

const code = await run(process.argv.slice(2));
if (code) process.exit(code);
