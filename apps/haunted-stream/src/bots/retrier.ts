// Stream tier: retrier.
import { defineStreamBot } from '../define';

export default defineStreamBot({ tier: 'retrier', use: ['retry'] });
