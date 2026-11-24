// Stream tier: journaler.
import { defineStreamBot } from '../define';

export default defineStreamBot({ tier: 'journaler', use: ['retry', 'journal'] });
