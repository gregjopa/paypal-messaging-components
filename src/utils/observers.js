import arrayFind from 'core-js-pure/stable/array/find';
import arrayFrom from 'core-js-pure/stable/array/from';
import stringStartsWith from 'core-js-pure/stable/string/starts-with';
import { ZalgoPromise } from 'zalgo-promise';

import { globalState, getGlobalVariable } from './global';
import { dynamicImport, getCurrentTime, DOMContentLoaded } from './miscellaneous';
import { logger } from './logger';
import { getNamespace } from './sdk';

export const attributeObserver = getGlobalVariable(
    '__attribute_observer__',
    () =>
        new MutationObserver(mutationList => {
            const { messagesMap } = globalState;
            const containersToUpdate = mutationList.reduce((accumulator, mutation) => {
                if (!messagesMap.has(mutation.target) || !stringStartsWith(mutation.attributeName, 'data-pp-')) {
                    return accumulator;
                }

                accumulator.push(mutation.target);

                return accumulator;
            }, []);

            // Re-render each container without options because the render will scan for all inline attributes
            containersToUpdate.forEach(container => window[getNamespace()]?.Messages().render(container));
        })
);

const getRoot = () => {
    const { innerWidth, innerHeight } = window;
    const elementsFromPoint = (typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint
        : document.msElementsFromPoint
    ).bind(document);

    const root = arrayFind(
        arrayFrom(elementsFromPoint(innerWidth / 2, innerHeight / 2)).reverse(),
        (el, index, elements) => {
            // We are searching for the element that contains the page scrolling.
            // Some merchant sites will use height 100% on elements such as html and body
            // that cause the intersection observer to hide elements below the fold.
            const { height } = window.getComputedStyle(el);
            const child = elements[index + 1];

            return (
                height !== `${innerHeight}px` ||
                // Ensure that the selected root is the larger of the parent and child
                (child && window.getComputedStyle(child).height < height)
            );
        }
    );

    return root;
};

export const overflowObserver = getGlobalVariable('__intersection_observer__', () =>
    ZalgoPromise.resolve(
        typeof window.IntersectionObserver === 'undefined'
            ? dynamicImport('https://polyfill.io/v3/polyfill.js?features=IntersectionObserver')
            : undefined
    )
        // Ensure DOM has loaded otherwise root can default to null (viewport)
        // and cause messages below the fold to hide
        // e.g. https://www.escortradar.com/products/escort_redline_360c
        .then(() => DOMContentLoaded)
        .then(() => {
            const root = getRoot();
            // eslint-disable-next-line compat/compat
            return new IntersectionObserver(
                (entries, observer) => {
                    const { messagesMap } = globalState;

                    entries.forEach(entry => {
                        const iframe = entry.target;
                        const container = iframe.parentNode.parentNode;
                        // If the library has been cleaned up by an SDK destroy, the container
                        // may not exist in the current SDK script messageMap. In this scenario
                        // we will short circuit on the state.render check
                        const { state } = messagesMap.get(container) || {};

                        // Only run in the context of a render call, and NOT when resizing the
                        // element for other reasons such as window resizing
                        if (!state?.renderStart) {
                            return;
                        }

                        const index = container.getAttribute('data-pp-id');
                        const minWidth = Number(iframe.getAttribute('data-width'));
                        const minHeight = Number(iframe.getAttribute('data-height'));
                        const duration = getCurrentTime() - state.renderStart;

                        let isIntersectingFallback;
                        // TODO: Further investigate why in some edge-cases the entry values are all 0.
                        // If this is the case we run our own calculations as a fallback.
                        // e.g. https://www.auto-protect-shop.de/nanolex-ultra-glasversiegelung-set/a-528
                        if (entry.rootBounds.width === 0 && entry.rootBounds.height === 0) {
                            const rootBounds = root.getBoundingClientRect();
                            const boundingClientRect = entry.target.getBoundingClientRect();

                            isIntersectingFallback =
                                rootBounds.top <= boundingClientRect.top &&
                                rootBounds.bottom >= boundingClientRect.bottom &&
                                rootBounds.left <= boundingClientRect.left &&
                                rootBounds.right >= boundingClientRect.right;
                        }

                        if (
                            (entry.intersectionRatio < 0.9 ||
                                // Round up for decimal values
                                Math.ceil(entry.boundingClientRect.width) < minWidth) &&
                            !isIntersectingFallback
                        ) {
                            if (container.getAttribute('data-pp-style-preset') === 'smallest') {
                                iframe.style.setProperty('opacity', '0', 'important');
                                iframe.style.setProperty('pointer-events', 'none', 'important');
                                logger.warn(state.renderComplete ? 'update_hidden' : 'hidden', {
                                    description: `PayPal Message has been hidden. Fallback message must be visible and requires minimum dimensions of ${minWidth}px x ${minHeight}px. Current container is ${entry.intersectionRect.width}px x ${entry.intersectionRect.height}px.`,
                                    container,
                                    index,
                                    duration
                                });
                                state.renderComplete = true;
                                delete state.renderStart;
                            } else {
                                iframe.style.setProperty('opacity', '0', 'important');
                                iframe.style.setProperty('pointer-events', 'none', 'important');
                                container.setAttribute('data-pp-style-preset', 'smallest');
                                logger.warn(state.renderComplete ? 'update_overflow' : 'overflow', {
                                    description: `PayPal Message attempting fallback. Message must be visible and requires minimum dimensions of ${minWidth}px x ${minHeight}px. Current container is ${entry.intersectionRect.width}px x ${entry.intersectionRect.height}px.`,
                                    container,
                                    index,
                                    duration
                                });
                            }

                            observer.unobserve(iframe);
                        } else {
                            logger.info(state.renderComplete ? 'update_visible' : 'visible', {
                                index,
                                duration
                            });

                            state.renderComplete = true;
                            delete state.renderStart;

                            observer.unobserve(iframe);
                        }
                    });
                },
                {
                    root
                }
            );
        })
);