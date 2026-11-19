import { describe, expect, it } from 'vitest';
import { QUESTION_CHARS, daysAgoIso, questionBefore, shortText } from '@/lib/feedback-review';

const convo = [
  { role: 'assistant', content: 'Hi! What are you working on?', id: 'r0' },
  { role: 'user', content: 'What did MahaVISTAAR do for farmers?' },
  { role: 'assistant', content: 'It built a WhatsApp advisory…', id: 'r1' },
  { role: 'user', content: 'EXTRACTED TEXT OF A 40-PAGE PDF', displayContent: 'Here is our report.pdf' },
  { role: 'user', content: 'internal kick-off prompt', hidden: true },
  { role: 'assistant', content: 'Your report covers…', id: 'r2' },
];

describe('questionBefore', () => {
  it('returns the user message just before the rated reply', () => {
    expect(questionBefore(convo, 'r1')).toEqual({ status: 'found', question: 'What did MahaVISTAAR do for farmers?' });
  });

  it('skips hidden prompts and shows an upload’s bubble text, never its extracted content', () => {
    const q = questionBefore(convo, 'r2');
    expect(q).toEqual({ status: 'found', question: 'Here is our report.pdf' });
    expect(JSON.stringify(q)).not.toContain('EXTRACTED');
    expect(JSON.stringify(q)).not.toContain('kick-off');
  });

  it('says there was no question before an opening message', () => {
    expect(questionBefore(convo, 'r0')).toEqual({ status: 'no_question' });
  });

  it('says the reply is gone when its id is not in the conversation', () => {
    expect(questionBefore(convo, 'missing')).toEqual({ status: 'reply_gone' });
  });

  it.each([[null], ['text'], [{}], [[null, 5, 'x', { id: 'r9' }]]])('tolerates malformed messages (%j)', (messages) => {
    expect(['reply_gone', 'no_question']).toContain(questionBefore(messages, 'r9').status);
  });

  it('falls back to content when displayContent is blank, and skips an empty user message', () => {
    const list = [
      { role: 'user', content: 'Real question', displayContent: '   ' },
      { role: 'user', content: '' },
      { role: 'assistant', content: 'answer', id: 'a' },
    ];
    expect(questionBefore(list, 'a')).toEqual({ status: 'found', question: 'Real question' });
  });

  it('caps a long question and flattens line breaks', () => {
    const list = [{ role: 'user', content: `line one\n\nline two ${'x'.repeat(2000)}` }, { role: 'assistant', content: 'a', id: 'a' }];
    const q = questionBefore(list, 'a');
    expect(q.status).toBe('found');
    if (q.status === 'found') {
      expect(q.question.length).toBe(QUESTION_CHARS);
      expect(q.question.startsWith('line one line two')).toBe(true);
      expect(q.question.endsWith('…')).toBe(true);
    }
  });
});

describe('shortText and daysAgoIso', () => {
  it('leaves short text alone', () => {
    expect(shortText('  hello   world ')).toBe('hello world');
  });

  it('gives the start of a period', () => {
    expect(daysAgoIso(7, new Date('2026-11-19T00:00:00Z'))).toBe('2026-11-12T00:00:00.000Z');
  });
});
