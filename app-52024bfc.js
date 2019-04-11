(function () {
	'use strict';
	'another marker';

	function fixCustomEvent() {

		if ( typeof window.CustomEvent === 'function' ) return false;

		function CustomEvent ( event, params ) {
			params = params || { bubbles: false, cancelable: false, detail: null };
			var evt = document.createEvent( 'CustomEvent' );
			evt.initCustomEvent( event, params.bubbles, params.cancelable, params.detail );
			return evt;
		}

		CustomEvent.prototype = window.Event.prototype;

		window.CustomEvent = CustomEvent;
	}

	function all() {
		fixCustomEvent();
	}

	function unwrapExports (x) {
		return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x.default : x;
	}

	function createCommonjsModule(fn, module) {
		return module = { exports: {} }, fn(module, module.exports), module.exports;
	}

	var slip = createCommonjsModule(function (module) {
	/*
	    Slip - swiping and reordering in lists of elements on touch screens, no fuss.

	    Fires these events on list elements:

	        • slip:swipe
	            When swipe has been done and user has lifted finger off the screen.
	            If you execute event.preventDefault() the element will be animated back to original position.
	            Otherwise it will be animated off the list and set to display:none.

	        • slip:beforeswipe
	            Fired before first swipe movement starts.
	            If you execute event.preventDefault() then element will not move at all.

	        • slip:cancelswipe
	            Fired after the user has started to swipe, but lets go without actually swiping left or right.

	        • slip:animateswipe
	            Fired while swiping, before the user has let go of the element.
	            event.detail.x contains the amount of movement in the x direction.
	            If you execute event.preventDefault() then the element will not move to this position.
	            This can be useful for saturating the amount of swipe, or preventing movement in one direction, but allowing it in the other.

	        • slip:reorder
	            Element has been dropped in new location. event.detail contains the following:
	                • insertBefore: DOM node before which element has been dropped (null is the end of the list). Use with node.insertBefore().
	                • spliceIndex: Index of element before which current element has been dropped, not counting the element iself.
	                               For use with Array.splice() if the list is reflecting objects in some array.
	                • originalIndex: The original index of the element before it was reordered.

	        • slip:beforereorder
	            When reordering movement starts.
	            Element being reordered gets class `slip-reordering`.
	            If you execute event.preventDefault() then the element will not move at all.

	        • slip:beforewait
	            If you execute event.preventDefault() then reordering will begin immediately, blocking ability to scroll the page.

	        • slip:tap
	            When element was tapped without being swiped/reordered. You can check `event.target` to limit that behavior to drag handles.


	    Usage:

	        CSS:
	            You should set `user-select:none` (and WebKit prefixes, sigh) on list elements,
	            otherwise unstoppable and glitchy text selection in iOS will get in the way.

	            You should set `overflow-x: hidden` on the container or body to prevent horizontal scrollbar
	            appearing when elements are swiped off the list.


	        var list = document.querySelector('ul#slippylist');
	        new Slip(list);

	        list.addEventListener('slip:beforeswipe', function(e) {
	            if (shouldNotSwipe(e.target)) e.preventDefault();
	        });

	        list.addEventListener('slip:swipe', function(e) {
	            // e.target swiped
	            if (thatWasSwipeToRemove) {
	                e.target.parentNode.removeChild(e.target);
	            } else {
	                e.preventDefault(); // will animate back to original position
	            }
	        });

	        list.addEventListener('slip:beforereorder', function(e) {
	            if (shouldNotReorder(e.target)) e.preventDefault();
	        });

	        list.addEventListener('slip:reorder', function(e) {
	            // e.target reordered.
	            if (reorderedOK) {
	                e.target.parentNode.insertBefore(e.target, e.detail.insertBefore);
	            } else {
	                e.preventDefault();
	            }
	        });

	    Requires:
	        • Touch events
	        • CSS transforms
	        • Function.bind()

	    Caveats:
	        • Elements must not change size while reordering or swiping takes place (otherwise it will be visually out of sync)
	*/
	/*! @license
	    Slip.js 1.2.0

	    © 2014 Kornel Lesiński <kornel@geekhood.net>. All rights reserved.

	    Redistribution and use in source and binary forms, with or without modification,
	    are permitted provided that the following conditions are met:

	    1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

	    2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and
	       the following disclaimer in the documentation and/or other materials provided with the distribution.

	    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
	    INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
	    DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
	    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
	    SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
	    WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
	    USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	*/

	window['Slip'] = (function(){

	    var accessibility = {
	        // Set values to false if you don't want Slip to manage them
	        container: {
	            ariaRole: "listbox",
	            tabIndex: 0,
	            focus: false, // focuses after drop
	        },
	        items: {
	            ariaRole: "option", // If "option" flattens items, try "group": https://www.marcozehe.de/2013/03/08/sometimes-you-have-to-use-illegal-wai-aria-to-make-stuff-work/
	            tabIndex: -1, // 0 will make every item tabbable, which isn't always useful
	            focus: false, // focuses when dragging
	        },
	    };

	    var damnYouChrome = /Chrome\/[3-5]/.test(navigator.userAgent); // For bugs that can't be programmatically detected :( Intended to catch all versions of Chrome 30-40
	    var needsBodyHandlerHack = damnYouChrome; // Otherwise I _sometimes_ don't get any touchstart events and only clicks instead.

	    /* When dragging elements down in Chrome (tested 34-37) dragged element may appear below stationary elements.
	       Looks like WebKit bug #61824, but iOS Safari doesn't have that problem. */
	    var compositorDoesNotOrderLayers = damnYouChrome;

	    // -webkit-mess
	    var testElementStyle = document.createElement('div').style;

	    var transitionJSPropertyName = "transition" in testElementStyle ? "transition" : "webkitTransition";
	    var transformJSPropertyName = "transform" in testElementStyle ? "transform" : "webkitTransform";
	    var transformCSSPropertyName = transformJSPropertyName === "webkitTransform" ? "-webkit-transform" : "transform";
	    var userSelectJSPropertyName = "userSelect" in testElementStyle ? "userSelect" : "webkitUserSelect";

	    testElementStyle[transformJSPropertyName] = 'translateZ(0)';
	    var hwLayerMagicStyle = testElementStyle[transformJSPropertyName] ? 'translateZ(0) ' : '';
	    var hwTopLayerMagicStyle = testElementStyle[transformJSPropertyName] ? 'translateZ(1px) ' : '';
	    testElementStyle = null;

	    var globalInstances = 0;
	    var attachedBodyHandlerHack = false;
	    var nullHandler = function(){};

	    function Slip(container, options) {
	        if ('string' === typeof container) container = document.querySelector(container);
	        if (!container || !container.addEventListener) throw new Error("Please specify DOM node to attach to");

	        if (!this || this === window) return new Slip(container, options);

	        this.options = options = options || {};
	        this.options.keepSwipingPercent = options.keepSwipingPercent || 0;
	        this.options.minimumSwipeVelocity = options.minimumSwipeVelocity || 1;
	        this.options.minimumSwipeTime = options.minimumSwipeTime || 110;

	        // Functions used for as event handlers need usable `this` and must not change to be removable
	        this.cancel = this.setState.bind(this, this.states.idle);
	        this.onTouchStart = this.onTouchStart.bind(this);
	        this.onTouchMove = this.onTouchMove.bind(this);
	        this.onTouchEnd = this.onTouchEnd.bind(this);
	        this.onMouseDown = this.onMouseDown.bind(this);
	        this.onMouseMove = this.onMouseMove.bind(this);
	        this.onMouseUp = this.onMouseUp.bind(this);
	        this.onMouseLeave = this.onMouseLeave.bind(this);
	        this.onSelection = this.onSelection.bind(this);
	        this.onContainerFocus = this.onContainerFocus.bind(this);

	        this.setState(this.states.idle);
	        this.attach(container);
	    }

	    function getTransform(node) {
	        var transform = node.style[transformJSPropertyName];
	        if (transform) {
	            return {
	                value: transform,
	                original: transform,
	            };
	        }

	        if (window.getComputedStyle) {
	            var style = window.getComputedStyle(node).getPropertyValue(transformCSSPropertyName);
	            if (style && style !== 'none') return {value:style, original:''};
	        }
	        return {value:'', original:''};
	    }

	    function findIndex(target, nodes) {
	      var originalIndex = 0;
	      var listCount = 0;

	      for (var i=0; i < nodes.length; i++) {
	        if (nodes[i].nodeType === 1) {
	          listCount++;
	          if (nodes[i] === target.node) {
	            originalIndex = listCount-1;
	          }
	        }
	      }

	      return originalIndex;
	    }

	    // All functions in states are going to be executed in context of Slip object
	    Slip.prototype = {

	        container: null,
	        options: {},
	        state: null,

	        target: null, // the tapped/swiped/reordered node with height and backed up styles

	        usingTouch: false, // there's no good way to detect touchscreen preference other than receiving a touch event (really, trust me).
	        mouseHandlersAttached: false,

	        startPosition: null, // x,y,time where first touch began
	        latestPosition: null, // x,y,time where the finger is currently
	        previousPosition: null, // x,y,time where the finger was ~100ms ago (for velocity calculation)

	        canPreventScrolling: false,

	        states: {
	            idle: function idleStateInit() {
	                this.removeMouseHandlers();
	                if (this.target) {
	                    this.target.node.style.willChange = '';
	                    this.target = null;
	                }
	                this.usingTouch = false;

	                return {
	                    allowTextSelection: true,
	                };
	            },

	            undecided: function undecidedStateInit() {
	                this.target.height = this.target.node.offsetHeight;
	                this.target.node.style.willChange = transformCSSPropertyName;
	                this.target.node.style[transitionJSPropertyName] = '';

	                if (!this.dispatch(this.target.originalTarget, 'beforewait')) {
	                    if (this.dispatch(this.target.originalTarget, 'beforereorder')) {
	                        this.setState(this.states.reorder);
	                    }
	                } else {
	                    var holdTimer = setTimeout(function(){
	                        var move = this.getAbsoluteMovement();
	                        if (this.canPreventScrolling && move.x < 15 && move.y < 25) {
	                            if (this.dispatch(this.target.originalTarget, 'beforereorder')) {
	                                this.setState(this.states.reorder);
	                            }
	                        }
	                    }.bind(this), 300);
	                }

	                return {
	                    leaveState: function() {
	                        clearTimeout(holdTimer);
	                    },

	                    onMove: function() {
	                        var move = this.getAbsoluteMovement();

	                        if (move.x > 20 && move.y < Math.max(100, this.target.height)) {
	                            if (this.dispatch(this.target.originalTarget, 'beforeswipe', {directionX: move.directionX, directionY: move.directionY})) {
	                                this.setState(this.states.swipe);
	                                return false;
	                            } else {
	                                this.setState(this.states.idle);
	                            }
	                        }
	                        if (move.y > 20) {
	                            this.setState(this.states.idle);
	                        }

	                        // Chrome likes sideways scrolling :(
	                        if (move.x > move.y*1.2) return false;
	                    },

	                    onLeave: function() {
	                        this.setState(this.states.idle);
	                    },

	                    onEnd: function() {
	                        var allowDefault = this.dispatch(this.target.originalTarget, 'tap');
	                        this.setState(this.states.idle);
	                        return allowDefault;
	                    },
	                };
	            },

	            swipe: function swipeStateInit() {
	                var swipeSuccess = false;
	                var container = this.container;

	                var originalIndex = findIndex(this.target, this.container.childNodes);

	                container.classList.add('slip-swiping-container');
	                function removeClass() {
	                    container.classList.remove('slip-swiping-container');
	                }

	                this.target.height = this.target.node.offsetHeight;

	                return {
	                    leaveState: function() {
	                        if (swipeSuccess) {
	                            this.animateSwipe(function(target){
	                                target.node.style[transformJSPropertyName] = target.baseTransform.original;
	                                target.node.style[transitionJSPropertyName] = '';
	                                if (this.dispatch(target.node, 'afterswipe')) {
	                                    removeClass();
	                                    return true;
	                                } else {
	                                    this.animateToZero(undefined, target);
	                                }
	                            }.bind(this));
	                        } else {
	                            this.animateToZero(removeClass);
	                        }
	                    },

	                    onMove: function() {
	                        var move = this.getTotalMovement();

	                        if (Math.abs(move.y) < this.target.height+20) {
	                            if (this.dispatch(this.target.node, 'animateswipe', {x: move.x, originalIndex: originalIndex})) {
	                                this.target.node.style[transformJSPropertyName] = 'translate(' + move.x + 'px,0) ' + hwLayerMagicStyle + this.target.baseTransform.value;
	                            }
	                            return false;
	                        } else {
	                            this.dispatch(this.target.node, 'cancelswipe');
	                            this.setState(this.states.idle);
	                        }
	                    },

	                    onLeave: function() {
	                        this.state.onEnd.call(this);
	                    },

	                    onEnd: function() {
	                        var move = this.getAbsoluteMovement();
	                        var velocity = move.x / move.time;

	                        // How far out has the item been swiped?
	                        var swipedPercent = Math.abs((this.startPosition.x - this.previousPosition.x) / this.container.clientWidth) * 100;

	                        var swiped = (velocity > this.options.minimumSwipeVelocity && move.time > this.options.minimumSwipeTime) || (this.options.keepSwipingPercent && swipedPercent > this.options.keepSwipingPercent);

	                        if (swiped) {
	                            if (this.dispatch(this.target.node, 'swipe', {direction: move.directionX, originalIndex: originalIndex})) {
	                                swipeSuccess = true; // can't animate here, leaveState overrides anim
	                            }
	                        } else {
	                            this.dispatch(this.target.node, 'cancelswipe');
	                        }
	                        this.setState(this.states.idle);
	                        return !swiped;
	                    },
	                };
	            },

	            reorder: function reorderStateInit() {
	                if (this.target.node.focus && accessibility.items.focus) {
	                    this.target.node.focus();
	                }

	                this.target.height = this.target.node.offsetHeight;

	                var nodes = this.container.childNodes;
	                var originalIndex = findIndex(this.target, nodes);
	                var mouseOutsideTimer;
	                var zero = this.target.node.offsetTop + this.target.height/2;
	                var otherNodes = [];
	                for(var i=0; i < nodes.length; i++) {
	                    if (nodes[i].nodeType != 1 || nodes[i] === this.target.node) continue;
	                    var t = nodes[i].offsetTop;
	                    nodes[i].style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.2s ease-in-out';
	                    otherNodes.push({
	                        node: nodes[i],
	                        baseTransform: getTransform(nodes[i]),
	                        pos: t + (t < zero ? nodes[i].offsetHeight : 0) - zero,
	                    });
	                }

	                this.target.node.classList.add('slip-reordering');
	                this.target.node.style.zIndex = '99999';
	                this.target.node.style[userSelectJSPropertyName] = 'none';
	                if (compositorDoesNotOrderLayers) {
	                    // Chrome's compositor doesn't sort 2D layers
	                    this.container.style.webkitTransformStyle = 'preserve-3d';
	                }

	                function onMove() {
	                    /*jshint validthis:true */

	                    this.updateScrolling();

	                    if (mouseOutsideTimer) {
	                        // don't care where the mouse is as long as it moves
	                        clearTimeout(mouseOutsideTimer); mouseOutsideTimer = null;
	                    }

	                    var move = this.getTotalMovement();
	                    this.target.node.style[transformJSPropertyName] = 'translate(0,' + move.y + 'px) ' + hwTopLayerMagicStyle + this.target.baseTransform.value;

	                    var height = this.target.height;
	                    otherNodes.forEach(function(o){
	                        var off = 0;
	                        if (o.pos < 0 && move.y < 0 && o.pos > move.y) {
	                            off = height;
	                        }
	                        else if (o.pos > 0 && move.y > 0 && o.pos < move.y) {
	                            off = -height;
	                        }
	                        // FIXME: should change accelerated/non-accelerated state lazily
	                        o.node.style[transformJSPropertyName] = off ? 'translate(0,'+off+'px) ' + hwLayerMagicStyle + o.baseTransform.value : o.baseTransform.original;
	                    });
	                    return false;
	                }

	                onMove.call(this);

	                return {
	                    leaveState: function() {
	                        if (mouseOutsideTimer) clearTimeout(mouseOutsideTimer);

	                        if (compositorDoesNotOrderLayers) {
	                            this.container.style.webkitTransformStyle = '';
	                        }

	                        if (this.container.focus && accessibility.container.focus) {
	                            this.container.focus();
	                        }

	                        this.target.node.classList.remove('slip-reordering');
	                        this.target.node.style[userSelectJSPropertyName] = '';

	                        this.animateToZero(function(target){
	                            target.node.style.zIndex = '';
	                        });
	                        otherNodes.forEach(function(o){
	                            o.node.style[transformJSPropertyName] = o.baseTransform.original;
	                            o.node.style[transitionJSPropertyName] = ''; // FIXME: animate to new position
	                        });
	                    },

	                    onMove: onMove,

	                    onLeave: function() {
	                        // don't let element get stuck if mouse left the window
	                        // but don't cancel immediately as it'd be annoying near window edges
	                        if (mouseOutsideTimer) clearTimeout(mouseOutsideTimer);
	                        mouseOutsideTimer = setTimeout(function(){
	                            mouseOutsideTimer = null;
	                            this.cancel();
	                        }.bind(this), 700);
	                    },

	                    onEnd: function() {
	                        var move = this.getTotalMovement();
	                        var i, spliceIndex;
	                        if (move.y < 0) {
	                            for (i=0; i < otherNodes.length; i++) {
	                                if (otherNodes[i].pos > move.y) {
	                                    break;
	                                }
	                            }
	                            spliceIndex = i;
	                        } else {
	                            for (i=otherNodes.length-1; i >= 0; i--) {
	                                if (otherNodes[i].pos < move.y) {
	                                    break;
	                                }
	                            }
	                            spliceIndex = i+1;
	                        }

	                        this.dispatch(this.target.node, 'reorder', {
	                            spliceIndex: spliceIndex,
	                            originalIndex: originalIndex,
	                            insertBefore: otherNodes[spliceIndex] ? otherNodes[spliceIndex].node : null,
	                        });

	                        this.setState(this.states.idle);
	                        return false;
	                    },
	                };
	            },
	        },

	        attach: function(container) {
	            globalInstances++;
	            if (this.container) this.detach();

	            // In some cases taps on list elements send *only* click events and no touch events. Spotted only in Chrome 32+
	            // Having event listener on body seems to solve the issue (although AFAIK may disable smooth scrolling as a side-effect)
	            if (!attachedBodyHandlerHack && needsBodyHandlerHack) {
	                attachedBodyHandlerHack = true;
	                document.body.addEventListener('touchstart', nullHandler, false);
	            }

	            this.container = container;

	            // Accessibility
	            {
	                this.container.tabIndex = accessibility.container.tabIndex;
	            }
	            {
	                this.container.setAttribute('aria-role', accessibility.container.ariaRole);
	            }
	            this.setChildNodesAriaRoles();
	            this.container.addEventListener('focus', this.onContainerFocus, false);

	            this.otherNodes = [];

	            // selection on iOS interferes with reordering
	            document.addEventListener("selectionchange", this.onSelection, false);

	            // cancel is called e.g. when iOS detects multitasking gesture
	            this.container.addEventListener('touchcancel', this.cancel, false);
	            this.container.addEventListener('touchstart', this.onTouchStart, false);
	            this.container.addEventListener('touchmove', this.onTouchMove, false);
	            this.container.addEventListener('touchend', this.onTouchEnd, false);
	            this.container.addEventListener('mousedown', this.onMouseDown, false);
	            // mousemove and mouseup are attached dynamically
	        },

	        detach: function() {
	            this.cancel();

	            this.container.removeEventListener('mousedown', this.onMouseDown, false);
	            this.container.removeEventListener('touchend', this.onTouchEnd, false);
	            this.container.removeEventListener('touchmove', this.onTouchMove, false);
	            this.container.removeEventListener('touchstart', this.onTouchStart, false);
	            this.container.removeEventListener('touchcancel', this.cancel, false);

	            document.removeEventListener("selectionchange", this.onSelection, false);

	            {
	                this.container.removeAttribute('tabIndex');
	            }
	            {
	                this.container.removeAttribute('aria-role');
	            }
	            this.unSetChildNodesAriaRoles();

	            globalInstances--;
	            if (!globalInstances && attachedBodyHandlerHack) {
	                attachedBodyHandlerHack = false;
	                document.body.removeEventListener('touchstart', nullHandler, false);
	            }
	        },

	        setState: function(newStateCtor){
	            if (this.state) {
	                if (this.state.ctor === newStateCtor) return;
	                if (this.state.leaveState) this.state.leaveState.call(this);
	            }

	            // Must be re-entrant in case ctor changes state
	            var prevState = this.state;
	            var nextState = newStateCtor.call(this);
	            if (this.state === prevState) {
	                nextState.ctor = newStateCtor;
	                this.state = nextState;
	            }
	        },

	        findTargetNode: function(targetNode) {
	            while(targetNode && targetNode.parentNode !== this.container) {
	                targetNode = targetNode.parentNode;
	            }
	            return targetNode;
	        },

	        onContainerFocus: function(e) {
	            this.setChildNodesAriaRoles();
	        },

	        setChildNodesAriaRoles: function() {
	            var nodes = this.container.childNodes;
	            for(var i=0; i < nodes.length; i++) {
	                if (nodes[i].nodeType != 1) continue;
	                {
	                    nodes[i].setAttribute('aria-role', accessibility.items.ariaRole);
	                }
	                {
	                    nodes[i].tabIndex = accessibility.items.tabIndex;
	                }
	            }
	        },

	        unSetChildNodesAriaRoles: function() {
	            var nodes = this.container.childNodes;
	            for(var i=0; i < nodes.length; i++) {
	                if (nodes[i].nodeType != 1) continue;
	                {
	                    nodes[i].removeAttribute('aria-role');
	                }
	                {
	                    nodes[i].removeAttribute('tabIndex');
	                }
	            }
	        },
	        onSelection: function(e) {
	            var isRelated = e.target === document || this.findTargetNode(e);
	            var iOS = /(iPhone|iPad|iPod)/i.test(navigator.userAgent) && !/(Android|Windows)/i.test(navigator.userAgent);
	            if (!isRelated) return;

	            if (iOS) {
	                // iOS doesn't allow selection to be prevented
	                this.setState(this.states.idle);
	            } else {
	                if (!this.state.allowTextSelection) {
	                    e.preventDefault();
	                }
	            }
	        },

	        addMouseHandlers: function() {
	            // unlike touch events, mousemove/up is not conveniently fired on the same element,
	            // but I don't need to listen to unrelated events all the time
	            if (!this.mouseHandlersAttached) {
	                this.mouseHandlersAttached = true;
	                document.documentElement.addEventListener('mouseleave', this.onMouseLeave, false);
	                window.addEventListener('mousemove', this.onMouseMove, true);
	                window.addEventListener('mouseup', this.onMouseUp, true);
	                window.addEventListener('blur', this.cancel, false);
	            }
	        },

	        removeMouseHandlers: function() {
	            if (this.mouseHandlersAttached) {
	                this.mouseHandlersAttached = false;
	                document.documentElement.removeEventListener('mouseleave', this.onMouseLeave, false);
	                window.removeEventListener('mousemove', this.onMouseMove, true);
	                window.removeEventListener('mouseup', this.onMouseUp, true);
	                window.removeEventListener('blur', this.cancel, false);
	            }
	        },

	        onMouseLeave: function(e) {
	            if (this.usingTouch) return;

	            if (e.target === document.documentElement || e.relatedTarget === document.documentElement) {
	                if (this.state.onLeave) {
	                    this.state.onLeave.call(this);
	                }
	            }
	        },

	        onMouseDown: function(e) {
	            if (this.usingTouch || e.button != 0 || !this.setTarget(e)) return;

	            this.addMouseHandlers(); // mouseup, etc.

	            this.canPreventScrolling = true; // or rather it doesn't apply to mouse

	            this.startAtPosition({
	                x: e.clientX,
	                y: e.clientY,
	                time: e.timeStamp,
	            });
	        },

	        onTouchStart: function(e) {
	            this.usingTouch = true;
	            this.canPreventScrolling = true;

	            // This implementation cares only about single touch
	            if (e.touches.length > 1) {
	                this.setState(this.states.idle);
	                return;
	            }

	            if (!this.setTarget(e)) return;

	            this.startAtPosition({
	                x: e.touches[0].clientX,
	                y: e.touches[0].clientY,
	                time: e.timeStamp,
	            });
	        },

	        setTarget: function(e) {
	            var targetNode = this.findTargetNode(e.target);
	            if (!targetNode) {
	                this.setState(this.states.idle);
	                return false;
	            }

	            //check for a scrollable parent
	            var scrollContainer = targetNode.parentNode;
	            while (scrollContainer) {
	                if (scrollContainer == document.body) break;
	                if (scrollContainer.scrollHeight > scrollContainer.clientHeight && window.getComputedStyle(scrollContainer)['overflow-y'] != 'visible') break;
	                scrollContainer = scrollContainer.parentNode;
	            }
	            scrollContainer = scrollContainer || document.body;

	            this.target = {
	                originalTarget: e.target,
	                node: targetNode,
	                scrollContainer: scrollContainer,
	                origScrollTop: scrollContainer.scrollTop,
	                origScrollHeight: scrollContainer.scrollHeight,
	                baseTransform: getTransform(targetNode),
	            };
	            return true;
	        },

	        startAtPosition: function(pos) {
	            this.startPosition = this.previousPosition = this.latestPosition = pos;
	            this.setState(this.states.undecided);
	        },

	        updatePosition: function(e, pos) {
	            if (this.target == null) {
	                return;
	            }
	            this.latestPosition = pos;

	            if (this.state.onMove) {
	                if (this.state.onMove.call(this) === false) {
	                    e.preventDefault();
	                }
	            }

	            // sample latestPosition 100ms for velocity
	            if (this.latestPosition.time - this.previousPosition.time > 100) {
	                this.previousPosition = this.latestPosition;
	            }
	        },

	        onMouseMove: function(e) {
	            this.updatePosition(e, {
	                x: e.clientX,
	                y: e.clientY,
	                time: e.timeStamp,
	            });
	        },

	        onTouchMove: function(e) {
	            this.updatePosition(e, {
	                x: e.touches[0].clientX,
	                y: e.touches[0].clientY,
	                time: e.timeStamp,
	            });

	            // In Apple's touch model only the first move event after touchstart can prevent scrolling (and event.cancelable is broken)
	            this.canPreventScrolling = false;
	        },

	        onMouseUp: function(e) {
	            if (this.usingTouch || e.button !== 0) return;

	            if (this.state.onEnd && false === this.state.onEnd.call(this)) {
	                e.preventDefault();
	            }
	        },

	        onTouchEnd: function(e) {
	            if (e.touches.length > 1) {
	                this.cancel();
	            } else if (this.state.onEnd && false === this.state.onEnd.call(this)) {
	                e.preventDefault();
	            }
	        },

	        getTotalMovement: function() {
	            var scrollOffset = this.target.scrollContainer.scrollTop - this.target.origScrollTop;
	            return {
	                x: this.latestPosition.x - this.startPosition.x,
	                y: this.latestPosition.y - this.startPosition.y + scrollOffset,
	                time: this.latestPosition.time - this.startPosition.time,
	            };
	        },

	        getAbsoluteMovement: function() {
	            var move = this.getTotalMovement();
	            return {
	                x: Math.abs(move.x),
	                y: Math.abs(move.y),
	                time: move.time,
	                directionX: move.x < 0 ? 'left' : 'right',
	                directionY: move.y < 0 ? 'up' : 'down',
	            };
	        },

	        updateScrolling: function() {
	            var triggerOffset = 40,
	                offset = 0;

	            var scrollable = this.target.scrollContainer,
	                containerRect = scrollable.getBoundingClientRect(),
	                targetRect = this.target.node.getBoundingClientRect(),
	                bottomOffset = Math.min(containerRect.bottom, window.innerHeight) - targetRect.bottom,
	                topOffset = targetRect.top - Math.max(containerRect.top, 0),
	                maxScrollTop = this.target.origScrollHeight - Math.min(scrollable.clientHeight, window.innerHeight);

	            if (bottomOffset < triggerOffset) {
	              offset = Math.min(triggerOffset, triggerOffset - bottomOffset);
	            }
	            else if (topOffset < triggerOffset) {
	              offset = Math.max(-triggerOffset, topOffset - triggerOffset);
	            }

	            scrollable.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollable.scrollTop + offset));
	        },

	        dispatch: function(targetNode, eventName, detail) {
	            var event = document.createEvent('CustomEvent');
	            if (event && event.initCustomEvent) {
	                event.initCustomEvent('slip:' + eventName, true, true, detail);
	            } else {
	                event = document.createEvent('Event');
	                event.initEvent('slip:' + eventName, true, true);
	                event.detail = detail;
	            }
	            return targetNode.dispatchEvent(event);
	        },

	        getSiblings: function(target) {
	            var siblings = [];
	            var tmp = target.node.nextSibling;
	            while(tmp) {
	                if (tmp.nodeType == 1) siblings.push({
	                    node: tmp,
	                    baseTransform: getTransform(tmp),
	                });
	                tmp = tmp.nextSibling;
	            }
	            return siblings;
	        },

	        animateToZero: function(callback, target) {
	            // save, because this.target/container could change during animation
	            target = target || this.target;

	            target.node.style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.1s ease-out';
	            target.node.style[transformJSPropertyName] = 'translate(0,0) ' + hwLayerMagicStyle + target.baseTransform.value;
	            setTimeout(function(){
	                target.node.style[transitionJSPropertyName] = '';
	                target.node.style[transformJSPropertyName] = target.baseTransform.original;
	                if (callback) callback.call(this, target);
	            }.bind(this), 101);
	        },

	        animateSwipe: function(callback) {
	            var target = this.target;
	            var siblings = this.getSiblings(target);
	            var emptySpaceTransformStyle = 'translate(0,' + this.target.height + 'px) ' + hwLayerMagicStyle + ' ';

	            // FIXME: animate with real velocity
	            target.node.style[transitionJSPropertyName] = 'all 0.1s linear';
	            target.node.style[transformJSPropertyName] = ' translate(' + (this.getTotalMovement().x > 0 ? '' : '-') + '100%,0) ' + hwLayerMagicStyle + target.baseTransform.value;

	            setTimeout(function(){
	                if (callback.call(this, target)) {
	                    siblings.forEach(function(o){
	                        o.node.style[transitionJSPropertyName] = '';
	                        o.node.style[transformJSPropertyName] = emptySpaceTransformStyle + o.baseTransform.value;
	                    });
	                    setTimeout(function(){
	                        siblings.forEach(function(o){
	                            o.node.style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.1s ease-in-out';
	                            o.node.style[transformJSPropertyName] = 'translate(0,0) ' + hwLayerMagicStyle + o.baseTransform.value;
	                        });
	                        setTimeout(function(){
	                            siblings.forEach(function(o){
	                                o.node.style[transitionJSPropertyName] = '';
	                                o.node.style[transformJSPropertyName] = o.baseTransform.original;
	                            });
	                        }, 101);
	                    }, 1);
	                }
	            }.bind(this), 101);
	        },
	    };
	    // CJS
	    if (module.exports) {
	        module.exports = Slip;
	    }
	    return Slip;
	})();
	});

	function init() {
		const listgroup = document.getElementById('pages-list');
		new slip(listgroup);

		listgroup.addEventListener('slip:reorder', (event) => {
			const { detail: {insertBefore}, target} = event;
			target.parentNode.insertBefore(target, insertBefore);
		});

		listgroup.addEventListener('slip:swipe', (event) => {
			event.target.parentNode.removeChild(event.target);
		});
	}

	function forEach(thisArg, callback) {
		for (var i = 0; i < thisArg.length; i++) {
			callback.call(thisArg, thisArg[i], i, thisArg);
		}
	}

	function debounce(func, wait, immediate) {
		var timeout;
		return function() {
			var context = this, args = arguments;
			var later = function() {
				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	}

	function randomId() {
		return 'id-' + Math.random().toString(36).substr(2, 9);
	}

	class WorkerInterface {
		constructor() {
			this.wrk = new Worker('./worker.js');
			this._message_handlers = {
				results: () => {},
				preloadResults: () => {},
			};
			this.wrk.onmessage = this._handleMessage.bind(this);
		}

		generate(params) {
			this.wrk.postMessage({type: 'generate', params});
		}

		setHandlerForResults(cb) {
			this._message_handlers.results = cb;
		}

		_handleMessage(e) {
			this._message_handlers[e.data.type](e.data);
		}

		setHandlerForPreloadResults(cb) {
			this._message_handlers.preloadResults = cb;
		}
		preloadFile(f) {
			this.wrk.postMessage({type: 'preload', file: f});
		}
	}

	function init$1() {
		return new WorkerInterface();
	}

	var multiIntegerRange = createCommonjsModule(function (module, exports) {
	/*! multi-integer-range (c) 2015 Soichiro Miki */
	Object.defineProperty(exports, "__esModule", { value: true });
	var defaultOptions = { parseNegative: false, parseUnbounded: false };
	var MAX_SAFE_INTEGER = 9007199254740991;
	var MIN_SAFE_INTEGER = -9007199254740991;
	var MultiRange = /** @class */ (function () {
	    /**
	     * Creates a new MultiRange object.
	     */
	    function MultiRange(data, options) {
	        if (options === void 0) { options = defaultOptions; }
	        function isArray(x) {
	            return Object.prototype.toString.call(x) === '[object Array]';
	        }
	        this.ranges = [];
	        this.options = {
	            parseNegative: !!options.parseNegative,
	            parseUnbounded: !!options.parseUnbounded
	        };
	        if (typeof data === 'string') {
	            this.parseString(data);
	        }
	        else if (typeof data === 'number') {
	            this.appendRange(data, data);
	        }
	        else if (data instanceof MultiRange) {
	            this.ranges = data.getRanges();
	            if (arguments[1] === undefined) {
	                this.options = {
	                    parseNegative: data.options.parseNegative,
	                    parseUnbounded: data.options.parseUnbounded
	                };
	            }
	        }
	        else if (isArray(data)) {
	            for (var _i = 0, _a = data; _i < _a.length; _i++) {
	                var item = _a[_i];
	                if (isArray(item)) {
	                    if (item.length === 2) {
	                        this.appendRange(item[0], item[1]);
	                    }
	                    else {
	                        throw new TypeError('Invalid array initializer');
	                    }
	                }
	                else if (typeof item === 'number') {
	                    this.append(item);
	                }
	                else {
	                    throw new TypeError('Invalid array initialzer');
	                }
	            }
	        }
	        else if (data !== undefined) {
	            throw new TypeError('Invalid input');
	        }
	    }
	    /**
	     * Parses the initializer string and build the range data.
	     * Override this if you need to customize the parsing strategy.
	     */
	    MultiRange.prototype.parseString = function (data) {
	        function toInt(str) {
	            var m = str.match(/^\(?(\-?\d+)/);
	            var int = parseInt(m[1], 10);
	            if (int < MIN_SAFE_INTEGER || MAX_SAFE_INTEGER < int)
	                throw new RangeError('The number is too big or too small.');
	            return int;
	        }
	        var s = data.replace(/\s/g, '');
	        if (!s.length)
	            return;
	        var match;
	        var int = this.options.parseNegative ? '(\\d+|\\(\\-?\\d+\\))' : '(\\d+)';
	        var intMatch = new RegExp('^' + int + '$');
	        var rangeMatch = new RegExp('^' + int + '?\\-' + int + '?$');
	        for (var _i = 0, _a = s.split(','); _i < _a.length; _i++) {
	            var r = _a[_i];
	            if ((match = r.match(intMatch))) {
	                var val = toInt(match[1]);
	                this.appendRange(val, val);
	            }
	            else if ((match = r.match(rangeMatch))) {
	                if (!this.options.parseUnbounded &&
	                    (match[1] === undefined || match[2] === undefined)) {
	                    throw new SyntaxError('Unexpected unbouded range notation');
	                }
	                var min = match[1] === undefined ? -Infinity : toInt(match[1]);
	                var max = match[2] === undefined ? +Infinity : toInt(match[2]);
	                this.appendRange(min, max);
	            }
	            else {
	                throw new SyntaxError('Invalid input');
	            }
	        }
	    };
	    /**
	     * Clones this instance.
	     * @returns The cloned instance.
	     */
	    MultiRange.prototype.clone = function () {
	        return new MultiRange(this);
	    };
	    /**
	     * Appends to this instance.
	     * @param value The data to append.
	     */
	    MultiRange.prototype.append = function (value) {
	        if (value === undefined) {
	            throw new TypeError('Invalid input');
	        }
	        else if (value instanceof MultiRange) {
	            for (var _i = 0, _a = value.ranges; _i < _a.length; _i++) {
	                var r = _a[_i];
	                this.appendRange(r[0], r[1]);
	            }
	            return this;
	        }
	        else {
	            return this.append(new MultiRange(value, this.options));
	        }
	    };
	    /**
	     * Appends a specified range of integers to this isntance.
	     * @param min The minimum value of the range to append.
	     * @param max The maximum value of the range to append.
	     */
	    MultiRange.prototype.appendRange = function (min, max) {
	        var newRange = [min, max];
	        if (newRange[0] > newRange[1]) {
	            newRange = [newRange[1], newRange[0]];
	        }
	        if ((newRange[0] === Infinity && newRange[1] === Infinity) ||
	            (newRange[0] === -Infinity && newRange[1] === -Infinity)) {
	            throw new RangeError('Infinity can be used only within an unbounded range segment');
	        }
	        var overlap = this.findOverlap(newRange);
	        this.ranges.splice(overlap.lo, overlap.count, overlap.union);
	        return this;
	    };
	    /**
	     * Subtracts from this instance.
	     * @param value The data to subtract.
	     */
	    MultiRange.prototype.subtract = function (value) {
	        if (value === undefined) {
	            throw new TypeError('Invalid input');
	        }
	        else if (value instanceof MultiRange) {
	            for (var _i = 0, _a = value.ranges; _i < _a.length; _i++) {
	                var r = _a[_i];
	                this.subtractRange(r[0], r[1]);
	            }
	            return this;
	        }
	        else {
	            return this.subtract(new MultiRange(value, this.options));
	        }
	    };
	    /**
	     * Subtracts a specified range of integers from this instance.
	     * @param min The minimum value of the range to subtract.
	     * @param max The maximum value of the range to subtract.
	     */
	    MultiRange.prototype.subtractRange = function (min, max) {
	        var newRange = [min, max];
	        if (newRange[0] > newRange[1]) {
	            newRange = [newRange[1], newRange[0]];
	        }
	        var overlap = this.findOverlap(newRange);
	        if (overlap.count > 0) {
	            var remain = [];
	            if (this.ranges[overlap.lo][0] < newRange[0]) {
	                remain.push([this.ranges[overlap.lo][0], newRange[0] - 1]);
	            }
	            if (newRange[1] < this.ranges[overlap.lo + overlap.count - 1][1]) {
	                remain.push([
	                    newRange[1] + 1,
	                    this.ranges[overlap.lo + overlap.count - 1][1]
	                ]);
	            }
	            this.ranges.splice.apply(this.ranges, [overlap.lo, overlap.count].concat(remain));
	        }
	        return this;
	    };
	    /**
	     * Remove integers which are not included in `value`,
	     * yielding the intersection of this and `value`.
	     * @param value The data to calculate the intersetion.
	     */
	    MultiRange.prototype.intersect = function (value) {
	        if (value === undefined) {
	            throw new TypeError('Invalid input');
	        }
	        else if (value instanceof MultiRange) {
	            var result = [];
	            var jstart = 0; // used for optimization
	            for (var i = 0; i < this.ranges.length; i++) {
	                var r1 = this.ranges[i];
	                for (var j = jstart; j < value.ranges.length; j++) {
	                    var r2 = value.ranges[j];
	                    if (r1[0] <= r2[1] && r1[1] >= r2[0]) {
	                        jstart = j;
	                        var min = Math.max(r1[0], r2[0]);
	                        var max = Math.min(r1[1], r2[1]);
	                        result.push([min, max]);
	                    }
	                    else if (r1[1] < r2[0]) {
	                        break;
	                    }
	                }
	            }
	            this.ranges = result;
	            return this;
	        }
	        else {
	            return this.intersect(new MultiRange(value, this.options));
	        }
	    };
	    /**
	     * Determines how the given range overlaps or touches the existing ranges.
	     * This is a helper method that calculates how an append/subtract operation
	     * affects the existing range members.
	     * @param target The range array to test.
	     * @returns An object containing information about how the given range
	     * overlaps or touches this instance.
	     */
	    MultiRange.prototype.findOverlap = function (target) {
	        //   a        b  c     d         e  f       g h i   j k  l       m
	        //--------------------------------------------------------------------
	        //   |----(0)----|     |---(1)---|  |---(2)---|          |--(3)--|
	        //            |------------(A)--------------|
	        //                                            |-(B)-|
	        //                                              |-(C)-|
	        //
	        // (0)-(3) represent the existing ranges (this.ranges),
	        // and (A)-(C) are the ranges being passed to this function.
	        //
	        // A pseudocode findOverlap(A) returns { lo: 0, count: 3, union: <a-h> },
	        // meaning (A) overlaps the 3 existing ranges from index 0.
	        //
	        // findOverlap(B) returns { lo: 2, count: 1, union: <f-j> },
	        // meaning (B) "touches" one range element, (2).
	        //
	        // findOverlap(C) returns { lo: 3, count: 0, union: <i-k> }
	        // meaning (C) is between (2) and (3) but overlaps/touches neither of them.
	        for (var hi = this.ranges.length - 1; hi >= 0; hi--) {
	            var r = this.ranges[hi];
	            var union = void 0;
	            if ((union = this.calcUnion(r, target))) {
	                var count = 1;
	                var tmp = void 0;
	                while (hi - count >= 0 &&
	                    (tmp = this.calcUnion(union, this.ranges[hi - count]))) {
	                    union = tmp;
	                    count++;
	                }
	                // The given target touches/overlaps one or more of the existing ranges
	                return { lo: hi + 1 - count, count: count, union: union };
	            }
	            else if (r[1] < target[0]) {
	                // The given target does not touch nor overlap the existing ranges
	                return { lo: hi + 1, count: 0, union: target };
	            }
	        }
	        // The given target is smaller than the smallest existing range
	        return { lo: 0, count: 0, union: target };
	    };
	    /**
	     * Calculates the union of two specified ranges.
	     * @param a Range A.
	     * @param b Range B.
	     * @returns Union of `a` and `b`.
	     *   Returns `null` if `a` and `b` do not touch nor intersect.
	     */
	    MultiRange.prototype.calcUnion = function (a, b) {
	        if (a[1] + 1 < b[0] || a[0] - 1 > b[1]) {
	            return null; // cannot make union
	        }
	        return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
	    };
	    /**
	     * Exports the whole range data as an array of arrays.
	     * @returns An copied array of range segments.
	     */
	    MultiRange.prototype.getRanges = function () {
	        var result = [];
	        for (var _i = 0, _a = this.ranges; _i < _a.length; _i++) {
	            var r = _a[_i];
	            result.push([r[0], r[1]]);
	        }
	        return result;
	    };
	    /**
	     * Checks if this instance contains the specified value.
	     * @param value Value to be checked.
	     * @returns True if the specified value is included in the instance.
	     */
	    MultiRange.prototype.has = function (value) {
	        if (value === undefined) {
	            throw new TypeError('Invalid input');
	        }
	        else if (value instanceof MultiRange) {
	            var s = 0;
	            var len = this.ranges.length;
	            for (var _i = 0, _a = value.ranges; _i < _a.length; _i++) {
	                var tr = _a[_i];
	                var i = void 0;
	                for (i = s; i < len; i++) {
	                    var my = this.ranges[i];
	                    if (tr[0] >= my[0] &&
	                        tr[1] <= my[1] &&
	                        tr[1] >= my[0] &&
	                        tr[1] <= my[1])
	                        break;
	                }
	                if (i === len)
	                    return false;
	            }
	            return true;
	        }
	        else {
	            return this.has(new MultiRange(value, this.options));
	        }
	    };
	    /**
	     * Checks if this instance contains the range specified by the two parameters.
	     * @param min The minimum value of the range to subtract.
	     * @param max The minimum value of the range to subtract.
	     * @returns True if the specified value is included in the instance.
	     */
	    MultiRange.prototype.hasRange = function (min, max) {
	        return this.has(new MultiRange([[min, max]]));
	    };
	    /**
	     * Returns the number of range segments.
	     * For example, the segmentLength of `2-5,7,9-11` is 3.
	     * @returns The number of segments. Returns 0 for an empty instance.
	     */
	    MultiRange.prototype.segmentLength = function () {
	        return this.ranges.length;
	    };
	    /**
	     * Calculates how many numbers are effectively included in this instance.
	     * For example, the length of `1-10,51-60,90` is 21.
	     * @returns The number of integer values in this instance.
	     *    Returns `Infinity` for an unbounded range.
	     */
	    MultiRange.prototype.length = function () {
	        if (this.isUnbounded())
	            return Infinity;
	        var result = 0;
	        for (var _i = 0, _a = this.ranges; _i < _a.length; _i++) {
	            var r = _a[_i];
	            result += r[1] - r[0] + 1;
	        }
	        return result;
	    };
	    /**
	     * Checks if two instances of MultiRange are identical.
	     * @param cmp The data to compare.
	     * @returns True if `cmp` is exactly the same as this instance.
	     */
	    MultiRange.prototype.equals = function (cmp) {
	        if (cmp === undefined) {
	            throw new TypeError('Invalid input');
	        }
	        else if (cmp instanceof MultiRange) {
	            if (cmp === this)
	                return true;
	            if (this.ranges.length !== cmp.ranges.length)
	                return false;
	            for (var i = 0; i < this.ranges.length; i++) {
	                if (this.ranges[i][0] !== cmp.ranges[i][0] ||
	                    this.ranges[i][1] !== cmp.ranges[i][1])
	                    return false;
	            }
	            return true;
	        }
	        else {
	            return this.equals(new MultiRange(cmp, this.options));
	        }
	    };
	    /**
	     * Checks if the current instance is unbounded (i.e., infinite).
	     */
	    MultiRange.prototype.isUnbounded = function () {
	        return (this.ranges.length > 0 &&
	            (this.ranges[0][0] === -Infinity ||
	                this.ranges[this.ranges.length - 1][1] === Infinity));
	    };
	    /**
	     * Returns the minimum integer contained in this insntance.
	     * Can be -Infinity or undefined.
	     * @returns The minimum integer of this instance.
	     */
	    MultiRange.prototype.min = function () {
	        if (this.ranges.length === 0)
	            return undefined;
	        return this.ranges[0][0];
	    };
	    /**
	     * Returns the maximum number contained in this insntance.
	     * Can be Infinity or undefined.
	     * @returns The maximum integer of this instance.
	     */
	    MultiRange.prototype.max = function () {
	        if (this.ranges.length === 0)
	            return undefined;
	        return this.ranges[this.ranges.length - 1][1];
	    };
	    /**
	     * Removes the smallest integer from this instance and returns it.
	     * @returns The minimum integer removed from this instance.
	     */
	    MultiRange.prototype.shift = function () {
	        var min = this.min();
	        if (min === -Infinity)
	            throw new RangeError('shift() was invoked on an unbounded MultiRange which contains -Infinity');
	        if (min !== undefined)
	            this.subtract(min);
	        return min;
	    };
	    /**
	     * Removes the largest integer from this instance and returns it.
	     * @returns The maximum integer removed from this instance.
	     */
	    MultiRange.prototype.pop = function () {
	        var max = this.max();
	        if (max === Infinity)
	            throw new RangeError('pop() was invoked on an unbounded MultiRange which contains +Infinity');
	        if (max !== undefined)
	            this.subtract(max);
	        return max;
	    };
	    /**
	     * Returns the string respresentation of this MultiRange.
	     */
	    MultiRange.prototype.toString = function () {
	        function wrap(i) {
	            return i >= 0 ? String(i) : "(" + i + ")";
	        }
	        var ranges = [];
	        for (var _i = 0, _a = this.ranges; _i < _a.length; _i++) {
	            var r = _a[_i];
	            if (r[0] === -Infinity) {
	                if (r[1] === Infinity) {
	                    ranges.push('-');
	                }
	                else {
	                    ranges.push("-" + wrap(r[1]));
	                }
	            }
	            else if (r[1] === Infinity) {
	                ranges.push(wrap(r[0]) + "-");
	            }
	            else if (r[0] == r[1]) {
	                ranges.push(wrap(r[0]));
	            }
	            else {
	                ranges.push(wrap(r[0]) + "-" + wrap(r[1]));
	            }
	        }
	        return ranges.join(',');
	    };
	    /**
	     * Builds a flat array of integers which holds all elements in this instance.
	     * Note that this may be slow and memory-consuming for large ranges.
	     * Consider using the iterator whenever possible.
	     */
	    MultiRange.prototype.toArray = function () {
	        if (this.isUnbounded()) {
	            throw new RangeError('You cannot build an array from an unbounded range');
	        }
	        var result = new Array(this.length());
	        var idx = 0;
	        for (var _i = 0, _a = this.ranges; _i < _a.length; _i++) {
	            var r = _a[_i];
	            for (var n = r[0]; n <= r[1]; n++) {
	                result[idx++] = n;
	            }
	        }
	        return result;
	    };
	    /**
	     * Returns an ES6-compatible iterator.
	     */
	    MultiRange.prototype.getIterator = function () {
	        var _this = this;
	        if (this.isUnbounded()) {
	            throw new RangeError('Unbounded ranges cannot be iterated over');
	        }
	        var i = 0, curRange = this.ranges[i], j = curRange ? curRange[0] : undefined;
	        return {
	            next: function () {
	                if (!curRange || j === undefined)
	                    return { done: true };
	                var ret = j;
	                if (++j > curRange[1]) {
	                    curRange = _this.ranges[++i];
	                    j = curRange ? curRange[0] : undefined;
	                }
	                return { value: ret };
	            }
	        };
	    };
	    return MultiRange;
	}());
	exports.MultiRange = MultiRange;
	exports.default = MultiRange;
	// Set ES6 iterator, if Symbol.iterator is defined
	/* istanbul ignore else */
	if (typeof Symbol === 'function' && 'iterator' in Symbol) {
	    MultiRange.prototype[Symbol.iterator] = MultiRange.prototype.getIterator;
	}
	/**
	 * A shorthand function to construct a new MultiRange instance.
	 * @returns The new MultiRnage instance.
	 */
	function multirange(data, options) {
	    return new MultiRange(data, options);
	}
	exports.multirange = multirange;
	});

	var MultiRange = unwrapExports(multiIntegerRange);
	var multiIntegerRange_1 = multiIntegerRange.MultiRange;
	var multiIntegerRange_2 = multiIntegerRange.multirange;

	function validatePagesInput (e) {
		if (!e.target.classList.contains('val-pages')) {
			return;
		}

		try {
			const mr = new MultiRange(e.target.value, {parseUnbounded: true});
			if (isFinite(mr.max()) && mr.max() > e.target.maxPages) {
				e.target.setCustomValidity('Page range out of bounds, limit is ' + e.target.maxPages);
				return;
			}

			e.target.reportValidity();
		} catch (err) {
			e.target.setCustomValidity('Page range not recognized. Please use one or more ranges, such as 1-3,5,2-');
		}
	}

	function addNewFilesToUI(files, wrk) {
		const pagesList = document.getElementById('pages-list');
		const pagesetTemplate = document.getElementById('pageset-template');

		forEach(files, f => {
			let clone = document.importNode(pagesetTemplate.content, true);
			let id = randomId();
			clone.querySelector('.list-group-item').classList.add('bg-secondary');

			clone.querySelector('.val-name').textContent = f.name;
			clone.querySelector('.val-info').textContent = '(loading)';
			clone.querySelector('.val-pages').value = '';
			clone.querySelector('.list-group-item').remix = { file: f };

			// connect label with input
			clone.querySelector('label').setAttribute('for', id);
			clone.querySelector('.val-pages').setAttribute('id', id);

			pagesList.appendChild(clone);
			wrk.preloadFile(f);
		});
	}

	function preloadResultsHandler(data) {
		const pagesList = document.getElementById('pages-list');

		forEach(pagesList.querySelectorAll('.list-group-item'), (lg) => {
			if (lg.remix.file.name === data.filename) {
				lg.classList.remove('bg-secondary');
				if (data.success) {
					const pagesMessage = data.maxPages === 1 ? '1 page' : '' + data.maxPages + ' pages';
					lg.querySelector('.val-info').textContent = '(' + pagesMessage + ')';

					let input = lg.querySelector('input');
					input.removeAttribute('disabled');
					input.maxPages = data.maxPages;
					input.value = '1-' + data.maxPages;

					lg.classList.add('remix-ok');
				} else {
					lg.querySelector('.val-info').textContent = '(error during loading: ' + data.error + ')';
					lg.classList.add('bg-warning');
				}
			}
		});
	}

	function generate(wrk) {
		const pages = document.querySelectorAll('#pages-list .list-group-item.remix-ok');

		let params = [];
		forEach(pages, p => {
			params.push({
				file: p.remix.file,
				pages: p.querySelector('.val-pages').value,
			});
		});

		wrk.generate({pages: params});
	}

	function forceDownloadFile(data) {
		const blob = new Blob([data.buffer], {type: 'application/pdf'});
		const url = window.URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.style.display = 'none';
		a.href = url;
		a.setAttribute('download', 'remixed.pdf');
		document.body.appendChild(a);
		a.click();

		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	}

	function init$2() {
		const wrk = init$1();
		wrk.setHandlerForResults(forceDownloadFile);
		wrk.setHandlerForPreloadResults(preloadResultsHandler);

		const triggerer = document.getElementById('filePickerTriggerLink');
		triggerer.addEventListener('click', (event) =>  {
			event.stopPropagation();
			event.preventDefault();
			filePicker.click();
		});

		const filePicker = document.getElementById('filePicker');
		filePicker.addEventListener('change', (event) => {
			addNewFilesToUI(event.target.files, wrk);
		});

		const generateButton = document.getElementById('generate');
		generateButton.addEventListener('click', () => generate(wrk));

		document.addEventListener('input', debounce(validatePagesInput, 250));

		// TODO: handle drag/drop
	}

	all();
	window.addEventListener('DOMContentLoaded', init);
	window.addEventListener('DOMContentLoaded', init$2);

}());
//# sourceMappingURL=app.js.map
