import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { act, createElement, StrictMode } from 'react';
import { BOOK_TIMING } from '../src/story/bookNavigation';

// CSS is exercised by the app build; this test mounts the actual React component and router.
register(`data:text/javascript,${encodeURIComponent(`export async function load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
}`)}`, import.meta.url);

test('the cover Start control opens the book and reaches an interactive prologue in StrictMode', async t => {
  const dom = new Window({ url: 'https://sword.test/' });
  const styles = dom.document.createElement('style');
  styles.textContent = ':root { --frame: #5b4a3a; --parchment-hi: #fff6d9; --parchment: #efe0b8; }\n'
    + await readFile(new URL('../src/components/BookMenu.css', import.meta.url), 'utf8');
  dom.document.head.append(styles);
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom, document: dom.document,
    navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element,
    Node: dom.Node, Event: dom.Event, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const { createRoot } = await import('react-dom/client');
  const { BookMenu } = await import('../src/components/BookMenu');
  const { navigate, useScreen } = await import('../src/hooks/useScreen');
  const arrived: number[] = [];
  function Book() {
    const screen = useScreen();
    return createElement(BookMenu, {
      spreads: [{ left: { title: 'Hello from Moss' }, right: { title: 'Your adventure', content:
        createElement('button', { onClick: () => navigate('login') }, 'Next page') } },
        { left: { title: 'The next chapter' }, right: { content:
          createElement('button', { onClick: () => navigate('home') }, 'Close the book') } }],
      spread: screen === 'login' ? 1 : 0, phase: screen === 'home' ? 'cover' : 'open', interactive: false, showNav: false,
      openingPage: { title: 'Every hero has a shadow.' },
      cover: createElement('button', { onClick: () => navigate('lore') }, 'Start'),
      onSpreadChange: index => arrived.push(index),
    });
  }
  const container = dom.document.createElement('div'); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  t.after(async () => {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  await act(async () => root.render(createElement(StrictMode, null, createElement(Book))));
  assert.ok(!container.textContent.includes('Hello from Moss'), 'Closed cover must not mount a page underneath its backing');
  assert.equal(container.querySelector('.book-stack-left'), null);
  const leftBinding = container.querySelector('.book-binding-left')!;
  const rightBinding = container.querySelector('.book-binding-right')!;
  assert.ok(leftBinding && rightBinding, 'The binding consists of two persistent halves');
  const start = [...container.querySelectorAll('button')].find(button => button.textContent === 'Start')!;
  assert.ok(start);
  assert.equal(start.closest('.book'), null, 'The clickable cover must stay outside the decorative 3D faces');
  assert.equal(container.querySelectorAll('.book-cover-entry button').length, 1);
  const coverRadius = dom.getComputedStyle(container.querySelector('.book-cover-entry')!).borderRadius;
  assert.equal(coverRadius, '0px 20px 20px 0px');
  assert.equal(start.closest('[inert]'), null);
  start.focus();
  assert.equal(dom.document.activeElement, start);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await act(async () => { start.click(); dom.dispatchEvent(new dom.Event('hashchange')); });
  assert.equal(dom.location.hash, '#lore');
  assert.ok(container.querySelector('.book-is-opening'));
  const coverBounds = dom.getComputedStyle(container.querySelector('.book-cover')!);
  const coverTop = coverBounds.top;
  const bindingBounds = dom.getComputedStyle(leftBinding);
  for (const property of ['top', 'bottom', 'width'] as const) {
    assert.notEqual(coverBounds[property], '');
    assert.equal(coverBounds[property], bindingBounds[property], `Moving and resting covers share ${property}`);
  }
  assert.equal(bindingBounds.visibility, 'hidden');
  assert.equal(dom.getComputedStyle(container.querySelector('.book-cover > .book-cover-front')!).borderRadius, coverRadius);
  assert.equal(dom.getComputedStyle(container.querySelector('.book-cover-back')!).borderRadius,
    '20px 0px 0px 20px', 'The opened cover has curved left corners and a square right spine');
  assert.ok(container.querySelector('.book-right .book-page-content'), 'The original right title page stays visible during opening');
  assert.equal(dom.getComputedStyle(container.querySelector('.book > .book-right')!).backgroundColor, '#fff6d9');
  const movingLining = container.querySelector('.book-cover-back .book-endpaper')!;
  const stationaryLining = container.querySelector('.book-binding-left .book-endpaper')!;
  const backLining = container.querySelector('.book-binding-right .book-endpaper')!;
  assert.ok(backLining, 'The back cover has matching inside cardboard');
  for (const lining of [movingLining, stationaryLining, backLining]) {
    const appearance = dom.getComputedStyle(lining);
    assert.equal(appearance.backgroundColor, '#c5a582');
    assert.notEqual(appearance.boxShadow, 'none');
    assert.ok(appearance.boxShadow.includes('inset'), 'The lining must exist while the cover is still moving');
    const sizing = dom.getComputedStyle(lining.parentElement!);
    assert.equal(sizing.transform, 'scale(.92)');
    assert.equal(sizing.transformOrigin, lining === backLining ? 'left center' : 'right center');
    assert.equal(lining === backLining ? sizing.left : sizing.right, '0px', 'The cardboard meets the spine without a scaling gap');
  }
  await act(async () => t.mock.timers.tick(BOOK_TIMING.open));
  assert.ok(container.querySelector('.book-is-first-page'));
  assert.equal(container.querySelector('.book-binding-left'), leftBinding);
  assert.equal(container.querySelector('.book-binding-right'), rightBinding);
  assert.equal(dom.getComputedStyle(leftBinding).visibility, 'visible');
  assert.equal(dom.getComputedStyle(leftBinding).top, coverTop, 'The resting cover keeps the same vertical alignment');
  assert.ok(['', 'none'].includes(dom.getComputedStyle(container.querySelector('.book > .book-right')!).transform),
    'The right page stays aligned during opening');
  assert.equal(container.querySelector('.book-left.book-inside-cover')!.textContent, '');
  assert.equal(container.querySelector('.book-stack-left'), null, 'No sheets should sit beneath the cardboard');
  assert.ok(!container.textContent.includes('Hello from Moss'));
  await act(async () => t.mock.timers.tick(BOOK_TIMING.firstPagePause));
  assert.ok(container.querySelector('.book-first-leaf'));
  assert.equal(dom.getComputedStyle(container.querySelector('.book-first-leaf')!).animationName, 'book-turn-first');
  assert.equal(dom.getComputedStyle(container.querySelector('.book-first-leaf')!).gridArea,
    dom.getComputedStyle(container.querySelector('.book > .book-right')!).gridArea, 'The first flip uses the actual sheet dimensions');
  const openingFlip = [...styles.sheet!.cssRules].find(rule =>
    'name' in rule && rule.name === 'book-turn-first') as unknown as CSSKeyframesRule;
  assert.equal(openingFlip.cssRules[openingFlip.cssRules.length - 1].style.transform, 'rotateY(-180deg)',
    'The opening leaf lands against the hinge without a sideways offset');
  const firstBackBorder = dom.getComputedStyle(container.querySelector('.book-first-leaf .back')!).borderRightWidth;
  const firstBackShadow = dom.getComputedStyle(container.querySelector('.book-first-leaf .back')!).boxShadow;
  const firstFront = dom.getComputedStyle(container.querySelector('.book-first-leaf .front')!);
  assert.equal(firstFront.borderLeftWidth, dom.getComputedStyle(container.querySelector('.book > .book-right')!).borderLeftWidth);
  assert.equal(container.querySelector('.book-left.book-inside-cover')!.textContent, '');
  assert.equal(container.querySelector('.book-stack-left'), null, 'The first flip must never reveal page layers');
  assert.deepEqual(arrived, []);
  await act(async () => t.mock.timers.tick(BOOK_TIMING.firstPageTurn));
  assert.ok(container.querySelector('.book-is-revealing'), 'A timer must not replace the first page before its animation finishes');
  const firstLeaf = container.querySelector('.book-first-leaf')!;
  const ended = (animationName: string) => Object.assign(new dom.Event('animationend', { bubbles: true }), { animationName });
  await act(async () => { firstLeaf.querySelector('.back')!.dispatchEvent(ended('book-page-shade')); });
  assert.ok(container.querySelector('.book-is-revealing'), 'Finishing a child shadow does not finish the page turn');
  await act(async () => { firstLeaf.dispatchEvent(ended('book-turn-first')); });
  assert.ok(container.querySelector('.book-is-open'));
  assert.equal(container.querySelectorAll('.book-binding').length, 2);
  assert.equal(container.querySelector('.book-binding-left'), leftBinding);
  assert.equal(container.querySelector('.book-inside-cover'), null);
  assert.equal(container.querySelector('.book-stack-left'), null, 'Landing the first page alone does not create layers');
  const firstSheet = container.querySelector('.book > .book-left')!;
  assert.ok(firstSheet);
  assert.equal(firstBackShadow, dom.getComputedStyle(firstSheet).boxShadow,
    'The first page keeps the same inner-edge shading when it becomes the resting page');
  assert.equal(firstBackBorder, dom.getComputedStyle(firstSheet).borderRightWidth,
    'The turning leaf lands with the same thin inner border as the resting left page');
  const sheetGeometry = (page: typeof firstSheet) => {
    const appearance = dom.getComputedStyle(page);
    return Object.fromEntries(['gridArea', 'transform', 'margin', 'borderTopWidth', 'borderBottomWidth',
      'borderLeftWidth', 'borderRightWidth'].map(property => [property, appearance[property]]));
  };
  const firstGeometry = sheetGeometry(firstSheet);
  assert.equal(container.querySelector('.book-binding-left .book-endpaper'), stationaryLining,
    'The same cardboard lining stays beneath the first sheet after it lands');
  assert.equal(dom.getComputedStyle(stationaryLining).backgroundColor, '#c5a582');
  assert.equal(stationaryLining.closest('.book-paper'), null, 'The cardboard must not be replaced with page content');
  assert.ok(['', 'none'].includes(dom.getComputedStyle(firstSheet).transform),
    'The first sheet meets the right page at the spine without a translated gap');
  assert.equal(dom.getComputedStyle(container.querySelector('.book > .book-left')!).borderRightWidth, '2px');
  assert.equal(dom.getComputedStyle(container.querySelector('.book > .book-right')!).borderLeftWidth, '2px');
  assert.deepEqual(arrived, [0]);
  const next = container.querySelector('.book-right button')!;
  assert.equal(next.closest('[inert]'), null);
  await act(async () => { next.click(); dom.dispatchEvent(new dom.Event('hashchange')); });
  assert.equal(container.querySelector('.book-first-leaf'), null, 'Following pages use the normal flip');
  assert.equal(dom.getComputedStyle(container.querySelector('.book-leaf.next')!).animationName, 'book-turn-next');
  const arrivingStack = container.querySelector('.book-stack-left')!;
  assert.ok(arrivingStack, 'The layers must be mounted beneath the second flip, before it lands');
  assert.equal(dom.getComputedStyle(arrivingStack).animationName, 'book-stack-arrive');
  assert.equal(dom.getComputedStyle(arrivingStack).animationDuration, `${BOOK_TIMING.turn}ms`,
    'The layer reveal runs alongside the page turn');
  const stackReveal = [...styles.sheet!.cssRules].find(rule =>
    'name' in rule && rule.name === 'book-stack-arrive') as unknown as CSSKeyframesRule;
  assert.equal(stackReveal.cssRules[0].style.clipPath, 'inset(-2px -2px -18px 100%)',
    'The layer reveal starts hidden without flashing a full stack');
  assert.equal(stackReveal.cssRules[1].keyText, '90%, 100%');
  assert.equal(stackReveal.cssRules[1].style.clipPath, 'inset(-2px -2px -18px -18px)',
    'All outer page edges are revealed before the turning page lands');
  assert.equal(container.querySelector('.book > .book-left'), firstSheet, 'The first sheet remains under the second page');
  assert.deepEqual(sheetGeometry(firstSheet), firstGeometry, 'Turning the next page keeps the original page aligned');
  await act(async () => new Promise(resolve => dom.setTimeout(resolve, BOOK_TIMING.turn + 20)));
  assert.deepEqual(sheetGeometry(container.querySelector('.book > .book-left')!), firstGeometry,
    'Landing the next page adds layers without changing the page dimensions, borders, or spine alignment');
  assert.equal(container.querySelector('.book-stack-left'), arrivingStack,
    'Landing keeps the existing stack instead of inserting a new one');
  assert.ok(!arrivingStack.classList.contains('book-stack-arriving'), 'Later turns do not replay the initial layer reveal');
  assert.equal(container.querySelector('.book-binding-left .book-endpaper'), stationaryLining);
  assert.equal(container.querySelector('.book-binding-right .book-endpaper'), backLining);
  const leftEdges = dom.getComputedStyle(container.querySelector('.book-stack-left')!).boxShadow;
  assert.ok(leftEdges.includes('-15px 15px 0 -1px #a98a6a'), 'The outermost left layer is brown binding');
  assert.ok(leftEdges.includes('-10px 10px 0 -1px #efe0b8'), 'The next layer is cream paper');
  assert.ok(leftEdges.includes('-5px 5px 0 -1px #efe0b8'), 'The inner layer is cream paper');
  const rightEdges = dom.getComputedStyle(container.querySelector('.book-stack-right')!).boxShadow;
  assert.ok(rightEdges.includes('5px 5px 0 -1px #efe0b8'));
  assert.ok(rightEdges.includes('10px 10px 0 -1px #efe0b8'));
  assert.ok(rightEdges.includes('15px 15px 0 -1px #c5a582'), 'Light-brown lining sits below both cream sheets');
  assert.ok(rightEdges.includes('20px 20px 0 -1px #a98a6a'), 'The brown back cover is the bottom layer');
  assert.deepEqual(arrived, [0, 1]);
  const close = container.querySelector('.book-right button')!;
  await act(async () => { close.click(); dom.dispatchEvent(new dom.Event('hashchange')); });
  assert.ok(container.querySelector('.book-is-shutting'));
  await act(async () => new Promise(resolve => dom.setTimeout(resolve, BOOK_TIMING.fold + 20)));
  const reopenedStart = container.querySelector('.book-cover-entry button')!;
  assert.ok(reopenedStart, 'Closing the book must restore a working Start control');
  await act(async () => { reopenedStart.click(); dom.dispatchEvent(new dom.Event('hashchange')); });
  assert.ok(container.querySelector('.book-is-opening'));
  assert.equal(container.querySelector('.book-stack-left'), null, 'Reopening resets the first-sheet sequence');
  await act(async () => t.mock.timers.tick(BOOK_TIMING.open + BOOK_TIMING.firstPagePause + BOOK_TIMING.firstPageTurn + BOOK_TIMING.firstPageFallback));
  assert.ok(container.querySelector('.book-is-open'));
});
