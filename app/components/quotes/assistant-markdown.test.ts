import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMarkdown } from './assistant-markdown';

describe('AssistantMarkdown', () => {
  it('renders Markdown structure, links, and GFM without exposing raw markers', () => {
    const html = renderToStaticMarkup(createElement(AssistantMarkdown, { text: '## Summary\n\n- **One** item\n- ~~Old~~ new item\n\n[Details](https://example.com)\n\n```sh\necho ok\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |' }));
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('<strong>One</strong>');
    expect(html).toContain('<del>Old</del>');
    expect(html).toContain('<li>');
    expect(html).toContain('<pre>');
    expect(html).toContain('<table>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('does not interpret HTML, unsafe links, or load remote images', () => {
    const html = renderToStaticMarkup(createElement(AssistantMarkdown, { text: '<script>alert(1)</script>\n\n[bad](javascript:alert(1)) ![diagram](https://example.com/tracker.png)' }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('src="https://example.com/tracker.png"');
    expect(html).toContain('diagram');
  });
});
