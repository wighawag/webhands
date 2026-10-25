import {chromium, type Browser, type Page} from 'playwright';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
	compileLocator,
	splitFrameHops,
	UnsupportedByTransportError,
} from '../src/index.js';

/**
 * The extension transport's locator compiler (ADR-0018) turns a raw locator
 * EXPRESSION into Playwright's internal selector without a browser. Parity is the
 * whole point, so the ORACLE here is Playwright itself: each expression is
 * evaluated against a real Playwright `Page` the same way the Playwright
 * transports evaluate it, and the resulting `Locator`'s selector must equal what
 * the compiler produced. (`_selector` is Playwright-internal; reading it in a
 * test is the price of checking against the real thing rather than a copy.)
 */
const EXPRESSIONS = [
	`page.locator('#go')`,
	`page.getByRole('button', { name: 'Search' })`,
	`page.getByRole('button', { name: 'Search', exact: true })`,
	`page.getByRole('heading', { level: 2, includeHidden: true })`,
	`page.getByRole('checkbox', { checked: false, disabled: true })`,
	`page.getByRole('link', { name: /sign "in"/i })`,
	`page.getByText('Hello world')`,
	`page.getByText('Hello', { exact: true })`,
	`page.getByText(/^Total: \\d+$/)`,
	`page.getByLabel('Email')`,
	`page.getByPlaceholder('Search\u2026')`,
	`page.getByAltText('logo')`,
	`page.getByTitle('Close "dialog"')`,
	`page.getByTestId('submit')`,
	`page.locator('li').filter({ hasText: 'Charlie' }).first()`,
	`page.locator('li').filter({ hasNotText: /x/ }).last()`,
	`page.locator('li').filter({ has: page.getByRole('button') }).nth(2)`,
	`page.locator('li').filter({ hasNot: page.locator('.done'), visible: true })`,
	`page.locator('form').locator('input[name="q"]')`,
	`page.locator('form').locator(page.getByRole('textbox'))`,
	`page.getByRole('button').and(page.getByTitle('Save'))`,
	`page.getByRole('button').or(page.getByRole('link'))`,
	`page.locator('div', { hasText: 'x' })`,
	`page.frameLocator('#outer').getByRole('button', { name: 'Inner' })`,
	`page.frameLocator('#outer').frameLocator('iframe').locator('#deep')`,
	`page.frameLocator('iframe').first().getByText('ok')`,
	`page.locator('iframe').contentFrame().getByRole('checkbox')`,
	`page.frameLocator('#outer').owner()`,
	`p.locator("aria-ref=e5")`,
	`page.locator('text=Sign in >> visible=true')`,
];

describe('compileLocator: Playwright selector parity', () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await chromium.launch();
		page = await browser.newPage();
	});

	afterAll(async () => {
		await browser.close();
	});

	for (const expression of EXPRESSIONS) {
		it(`matches Playwright for ${expression}`, () => {
			// eslint-disable-next-line no-new-func
			const factory = new Function('page', 'p', `return (${expression});`) as (
				page: Page,
				p: Page,
			) => {_selector: string};
			const expected = factory(page, page)._selector;
			expect(compileLocator(expression)).toBe(expected);
		});
	}
});

describe('compileLocator: loud refusals', () => {
	it('refuses an action method inside the expression, naming it', () => {
		expect(() => compileLocator(`page.getByRole('button').click()`)).toThrow(
			UnsupportedByTransportError,
		);
		expect(() => compileLocator(`page.getByRole('button').click()`)).toThrow(
			/locator\.click/,
		);
	});

	it('refuses a page method that does not build a locator', () => {
		expect(() => compileLocator(`page.evaluate('1')`)).toThrow(
			/page\.evaluate/,
		);
	});

	it('refuses an expression that ends at a frame locator', () => {
		expect(() => compileLocator(`page.frameLocator('iframe')`)).toThrow(
			/element step/,
		);
	});

	it('reports a syntax error as an invalid expression', () => {
		expect(() => compileLocator(`page.getByRole(`)).toThrow(
			/invalid locator expression/,
		);
	});
});

describe('splitFrameHops', () => {
	it('splits at each frame hop, frame selectors first', () => {
		const selector = compileLocator(
			`page.frameLocator('#a').frameLocator('iframe').getByRole('button')`,
		);
		expect(splitFrameHops(selector)).toEqual([
			'#a',
			'iframe',
			'internal:role=button',
		]);
	});

	it('refuses a hop hidden inside a nested selector instead of mis-splitting', () => {
		const selector = compileLocator(
			`page.locator('li').filter({ has: page.frameLocator('iframe').getByRole('button') })`,
		);
		expect(() => splitFrameHops(selector)).toThrow(/nested selector/);
	});

	it('leaves a selector with no hop whole', () => {
		expect(splitFrameHops('internal:text="x"i >> nth=0')).toEqual([
			'internal:text="x"i >> nth=0',
		]);
	});
});
