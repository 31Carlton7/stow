import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import hljs from "highlight.js/lib/core";
import { Markdown, renderMarkdown } from "./Markdown";
import { GRAMMARS } from "./highlight";
import { loadHighlighter } from "./highlight-loader";

// highlight.js loads after boot in the app; these cases are about what it draws.
beforeAll(loadHighlighter);

describe("a model's prose as Markdown", () => {
  it("tokenises a fence whose language it knows, by the labels agents write", () => {
    expect(renderMarkdown("```ts\nconst a = 1;\n```")).toContain('class="hljs-keyword"');
    expect(renderMarkdown("```sh\nls -la\n```")).toContain("hljs-");
    expect(renderMarkdown("```py\nimport os\n```")).toContain("hljs-");
  });

  it("leaves an unlabelled or unknown fence alone rather than guessing at its language", () => {
    expect(renderMarkdown("```\nplain text\n```")).not.toContain("hljs-");
    expect(renderMarkdown("```wat\nplain text\n```")).not.toContain("hljs-");
  });

  it("names exactly the grammars highlight.js registered, with their own aliases", () => {
    const registered = Object.fromEntries(hljs.listLanguages().map((name) => [name, hljs.getLanguage(name)?.aliases ?? []]));
    expect(GRAMMARS).toEqual(registered);
  });

  it("lets nothing a transcript holds run: scripts, handlers and script links are dropped", () => {
    const html = renderMarkdown("<script>alert(1)</script><img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(renderMarkdown("[go](javascript:alert(1))")).not.toContain("href");
  });

  it("still escapes what it highlights", () => {
    const code = renderMarkdown("```ts\nconst a = '<img src=x onerror=alert(1)>';\n```");
    expect(code).not.toContain("<img");
    expect(code).toContain("&lt;img");
  });

  it("opens a link outside the window", () => {
    expect(renderMarkdown("[docs](https://example.com)")).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>');
  });

  it("heads a fenced block with its language, lets a wide table scroll, and titles a callout", () => {
    const { container } = render(<Markdown text={"```json\n{}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> [!WARNING]\n> Do not force-push."} />);
    expect(container.querySelector(".md-code .md-code-lang")!.textContent).toBe("json");
    expect(container.querySelector(".md-scroll > table")).not.toBeNull();
    const callout = container.querySelector(".md-callout")!;
    expect(callout.getAttribute("data-kind")).toBe("warning");
    expect(callout.querySelector(".md-callout-head")!.textContent).toBe("Warning");
    expect(callout.querySelector("p")!.textContent).toBe("Do not force-push.");
  });

  it("copies a fenced block as it was written", () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(<Markdown text={"```sh\npnpm build\n```"} />);
    const copy = container.querySelector(".md-copy")!;
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("pnpm build\n");
    expect(copy.hasAttribute("data-copied")).toBe(true);
  });
});
