// src/draft.ts
var e = class {
	constructor(e = {}) {
		this.fields = {}, this.opened = Object.fromEntries(Object.entries(e).filter(([, e]) => !n(e)));
	}
	show(e, n) {
		let r = this.fields[e] ??= {};
		t(r.shown, n) || (r.declined = !1), r.shown = { ...n }, delete r.held;
	}
	hold(e, t) {
		if (!(t > 0 && t <= 1)) throw RangeError("a check is drawn with a probability above 0 and at most 1");
		this.fields[e] = { held: t };
	}
	decline(e) {
		let t = this.fields[e];
		return t?.shown ? (t.declined = !0, !0) : !1;
	}
	declined(e, n) {
		let r = this.fields[e];
		return r?.declined === !0 && t(r.shown, n);
	}
	shown(e) {
		return this.fields[e]?.shown;
	}
	held(e) {
		return this.fields[e]?.held;
	}
	toJSON() {
		return {
			opened: this.opened,
			fields: this.fields
		};
	}
};
function t(e, t) {
	return e !== void 0 && e.value === t.value && (e.origin ?? "decider") === (t.origin ?? "decider") && (e.fit ?? "exact") === (t.fit ?? "exact");
}
function n(e) {
	return e === void 0 || (Array.isArray(e) ? e.every((e) => e === "") : e === "");
}
function r(e) {
	let t = {};
	for (let [r, i] of Object.entries(e)) {
		let e = Array.isArray(i) ? i.map(String) : i == null ? void 0 : String(i);
		e !== void 0 && !n(e) && (t[r] = e);
	}
	return t;
}
// src/session.ts
var i = {
	decline: "Not this",
	fromValue: "As before with {field} {value}",
	fromSimilar: "As in a similar record",
	fromJudgement: "Suggested from what was written"
}, a = class {
	constructor(t, n, r = .05, a = Math.random, o = i) {
		this.id = t, this.rate = r, this.random = a, this.strings = o, this.drawn = /* @__PURE__ */ new Set(), this.filled = /* @__PURE__ */ new Set(), this.draft = new e(n);
	}
	apply(e, t) {
		let r = {
			fieldStates: {},
			prefill: {}
		};
		for (let i of e) {
			let { field: e, suggestion: a } = i;
			a && (this.draw(e, a) || this.draft.held(e) === void 0 && (this.draft.declined(e, a) || (this.draft.show(e, a), i.prefill && n(t[e]) && (r.prefill[e] = a.value, this.filled.add(e)), r.fieldStates[e] = {
				suggestions: [a.value],
				decline: this.strings.decline,
				...this.note(i, t) ? { note: this.note(i, t) } : {}
			})));
		}
		return r;
	}
	decline(e, t) {
		let n = this.draft.shown(e);
		if (!this.draft.decline(e)) return !1;
		let r = this.filled.has(e) && t[e] === n?.value;
		return this.filled.delete(e), r;
	}
	saved(t) {
		this.draft = new e(t), this.drawn.clear(), this.filled.clear();
	}
	draw(e, t) {
		return this.drawn.has(e) ? this.draft.held(e) !== void 0 : (t.origin ?? "decider") !== "decider" || (t.fit ?? "exact") !== "exact" ? !1 : (this.drawn.add(e), this.rate > 0 && this.rate <= 1 && this.random() < this.rate && (this.draft.hold(e, this.rate), !0));
	}
	note(e, t) {
		let n = e.basis?.[0];
		if (e.layer === "key" && n?.kind === "value") {
			let e = t[n.field], r = e === void 0 ? n.value : Array.isArray(e) ? e.join(", ") : e;
			return this.strings.fromValue.replace("{field}", n.field).replace("{value}", r);
		}
		if (e.layer === "similar") return this.strings.fromSimilar;
		if (e.layer === "judgement") return this.strings.fromJudgement;
	}
}, o = class extends Error {
	constructor(e, t) {
		super(t), this.status = e, this.name = "LowlineError";
	}
}, s = class {
	constructor(e, t = (...e) => fetch(...e)) {
		this.src = e, this.fetcher = t;
	}
	propose(e, t, n) {
		return this.post(e, "propose", {
			id: t,
			values: n
		});
	}
	settle(e, t, n, r) {
		return this.post(e, "settle", {
			id: t,
			saved: n,
			draft: r
		});
	}
	async post(e, t, n) {
		let r = `${this.src.replace(/\/+$/, "")}/${encodeURIComponent(e)}/${t}`, i = await this.fetcher(r, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(n),
			credentials: "same-origin"
		});
		if (!i.ok) {
			let e = await i.json().catch(() => void 0);
			throw new o(i.status, e?.detail ?? `${t} answered ${i.status}`);
		}
		return await i.json();
	}
}, c = globalThis, l = c.ShadowRoot && (c.ShadyCSS === void 0 || c.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype, u = Symbol(), d = /* @__PURE__ */ new WeakMap(), f = class {
	constructor(e, t, n) {
		if (this._$cssResult$ = !0, n !== u) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
		this.cssText = e, this.t = t;
	}
	get styleSheet() {
		let e = this.o, t = this.t;
		if (l && e === void 0) {
			let n = t !== void 0 && t.length === 1;
			n && (e = d.get(t)), e === void 0 && ((this.o = e = new CSSStyleSheet()).replaceSync(this.cssText), n && d.set(t, e));
		}
		return e;
	}
	toString() {
		return this.cssText;
	}
}, p = (e) => new f(typeof e == "string" ? e : e + "", void 0, u), m = (e, ...t) => new f(e.length === 1 ? e[0] : t.reduce((t, n, r) => t + ((e) => {
	if (!0 === e._$cssResult$) return e.cssText;
	if (typeof e == "number") return e;
	throw Error("Value passed to 'css' function must be a 'css' function result: " + e + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
})(n) + e[r + 1], e[0]), e, u), h = (e, t) => {
	if (l) e.adoptedStyleSheets = t.map((e) => e instanceof CSSStyleSheet ? e : e.styleSheet);
	else for (let n of t) {
		let t = document.createElement("style"), r = c.litNonce;
		r !== void 0 && t.setAttribute("nonce", r), t.textContent = n.cssText, e.appendChild(t);
	}
}, g = l ? (e) => e : (e) => e instanceof CSSStyleSheet ? ((e) => {
	let t = "";
	for (let n of e.cssRules) t += n.cssText;
	return p(t);
})(e) : e, { is: _, defineProperty: v, getOwnPropertyDescriptor: y, getOwnPropertyNames: b, getOwnPropertySymbols: x, getPrototypeOf: S } = Object, ee = globalThis, te = ee.trustedTypes, ne = te ? te.emptyScript : "", re = ee.reactiveElementPolyfillSupport, C = (e, t) => e, w = {
	toAttribute(e, t) {
		switch (t) {
			case Boolean:
				e = e ? ne : null;
				break;
			case Object:
			case Array: e = e == null ? e : JSON.stringify(e);
		}
		return e;
	},
	fromAttribute(e, t) {
		let n = e;
		switch (t) {
			case Boolean:
				n = e !== null;
				break;
			case Number:
				n = e === null ? null : Number(e);
				break;
			case Object:
			case Array: try {
				n = JSON.parse(e);
			} catch {
				n = null;
			}
		}
		return n;
	}
}, T = (e, t) => !_(e, t), ie = {
	attribute: !0,
	type: String,
	converter: w,
	reflect: !1,
	useDefault: !1,
	hasChanged: T
};
Symbol.metadata ??= Symbol("metadata"), ee.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var ae = class extends HTMLElement {
	static addInitializer(e) {
		this._$Ei(), (this.l ??= []).push(e);
	}
	static get observedAttributes() {
		return this.finalize(), this._$Eh && [...this._$Eh.keys()];
	}
	static createProperty(e, t = ie) {
		if (t.state && (t.attribute = !1), this._$Ei(), this.prototype.hasOwnProperty(e) && ((t = Object.create(t)).wrapped = !0), this.elementProperties.set(e, t), !t.noAccessor) {
			let n = Symbol(), r = this.getPropertyDescriptor(e, n, t);
			r !== void 0 && v(this.prototype, e, r);
		}
	}
	static getPropertyDescriptor(e, t, n) {
		let { get: r, set: i } = y(this.prototype, e) ?? {
			get() {
				return this[t];
			},
			set(e) {
				this[t] = e;
			}
		};
		return {
			get: r,
			set(t) {
				let a = r?.call(this);
				i?.call(this, t), this.requestUpdate(e, a, n);
			},
			configurable: !0,
			enumerable: !0
		};
	}
	static getPropertyOptions(e) {
		return this.elementProperties.get(e) ?? ie;
	}
	static _$Ei() {
		if (this.hasOwnProperty(C("elementProperties"))) return;
		let e = S(this);
		e.finalize(), e.l !== void 0 && (this.l = [...e.l]), this.elementProperties = new Map(e.elementProperties);
	}
	static finalize() {
		if (this.hasOwnProperty(C("finalized"))) return;
		if (this.finalized = !0, this._$Ei(), this.hasOwnProperty(C("properties"))) {
			let e = this.properties, t = [...b(e), ...x(e)];
			for (let n of t) this.createProperty(n, e[n]);
		}
		let e = this[Symbol.metadata];
		if (e !== null) {
			let t = litPropertyMetadata.get(e);
			if (t !== void 0) for (let [e, n] of t) this.elementProperties.set(e, n);
		}
		this._$Eh = /* @__PURE__ */ new Map();
		for (let [e, t] of this.elementProperties) {
			let n = this._$Eu(e, t);
			n !== void 0 && this._$Eh.set(n, e);
		}
		this.elementStyles = this.finalizeStyles(this.styles);
	}
	static finalizeStyles(e) {
		let t = [];
		if (Array.isArray(e)) {
			let n = new Set(e.flat(1 / 0).reverse());
			for (let e of n) t.unshift(g(e));
		} else e !== void 0 && t.push(g(e));
		return t;
	}
	static _$Eu(e, t) {
		let n = t.attribute;
		return !1 === n ? void 0 : typeof n == "string" ? n : typeof e == "string" ? e.toLowerCase() : void 0;
	}
	constructor() {
		super(), this._$Ep = void 0, this.isUpdatePending = !1, this.hasUpdated = !1, this._$Em = null, this._$Ev();
	}
	_$Ev() {
		this._$ES = new Promise((e) => this.enableUpdating = e), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((e) => e(this));
	}
	addController(e) {
		(this._$EO ??= /* @__PURE__ */ new Set()).add(e), this.renderRoot !== void 0 && this.isConnected && e.hostConnected?.();
	}
	removeController(e) {
		this._$EO?.delete(e);
	}
	_$E_() {
		let e = /* @__PURE__ */ new Map(), t = this.constructor.elementProperties;
		for (let n of t.keys()) this.hasOwnProperty(n) && (e.set(n, this[n]), delete this[n]);
		e.size > 0 && (this._$Ep = e);
	}
	createRenderRoot() {
		let e = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
		return h(e, this.constructor.elementStyles), e;
	}
	connectedCallback() {
		this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(!0), this._$EO?.forEach((e) => e.hostConnected?.());
	}
	enableUpdating(e) {}
	disconnectedCallback() {
		this._$EO?.forEach((e) => e.hostDisconnected?.());
	}
	attributeChangedCallback(e, t, n) {
		this._$AK(e, n);
	}
	_$ET(e, t) {
		let n = this.constructor.elementProperties.get(e), r = this.constructor._$Eu(e, n);
		if (r !== void 0 && !0 === n.reflect) {
			let i = (n.converter?.toAttribute === void 0 ? w : n.converter).toAttribute(t, n.type);
			this._$Em = e, i == null ? this.removeAttribute(r) : this.setAttribute(r, i), this._$Em = null;
		}
	}
	_$AK(e, t) {
		let n = this.constructor, r = n._$Eh.get(e);
		if (r !== void 0 && this._$Em !== r) {
			let e = n.getPropertyOptions(r), i = typeof e.converter == "function" ? { fromAttribute: e.converter } : e.converter?.fromAttribute === void 0 ? w : e.converter;
			this._$Em = r;
			let a = i.fromAttribute(t, e.type);
			this[r] = a ?? this._$Ej?.get(r) ?? a, this._$Em = null;
		}
	}
	requestUpdate(e, t, n, r = !1, i) {
		if (e !== void 0) {
			let a = this.constructor;
			if (!1 === r && (i = this[e]), n ??= a.getPropertyOptions(e), !((n.hasChanged ?? T)(i, t) || n.useDefault && n.reflect && i === this._$Ej?.get(e) && !this.hasAttribute(a._$Eu(e, n)))) return;
			this.C(e, t, n);
		}
		!1 === this.isUpdatePending && (this._$ES = this._$EP());
	}
	C(e, t, { useDefault: n, reflect: r, wrapped: i }, a) {
		n && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(e) && (this._$Ej.set(e, a ?? t ?? this[e]), !0 !== i || a !== void 0) || (this._$AL.has(e) || (this.hasUpdated || n || (t = void 0), this._$AL.set(e, t)), !0 === r && this._$Em !== e && (this._$Eq ??= /* @__PURE__ */ new Set()).add(e));
	}
	async _$EP() {
		this.isUpdatePending = !0;
		try {
			await this._$ES;
		} catch (e) {
			Promise.reject(e);
		}
		let e = this.scheduleUpdate();
		return e != null && await e, !this.isUpdatePending;
	}
	scheduleUpdate() {
		return this.performUpdate();
	}
	performUpdate() {
		if (!this.isUpdatePending) return;
		if (!this.hasUpdated) {
			if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
				for (let [e, t] of this._$Ep) this[e] = t;
				this._$Ep = void 0;
			}
			let e = this.constructor.elementProperties;
			if (e.size > 0) for (let [t, n] of e) {
				let { wrapped: e } = n, r = this[t];
				!0 !== e || this._$AL.has(t) || r === void 0 || this.C(t, void 0, n, r);
			}
		}
		let e = !1, t = this._$AL;
		try {
			e = this.shouldUpdate(t), e ? (this.willUpdate(t), this._$EO?.forEach((e) => e.hostUpdate?.()), this.update(t)) : this._$EM();
		} catch (t) {
			throw e = !1, this._$EM(), t;
		}
		e && this._$AE(t);
	}
	willUpdate(e) {}
	_$AE(e) {
		this._$EO?.forEach((e) => e.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = !0, this.firstUpdated(e)), this.updated(e);
	}
	_$EM() {
		this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = !1;
	}
	get updateComplete() {
		return this.getUpdateComplete();
	}
	getUpdateComplete() {
		return this._$ES;
	}
	shouldUpdate(e) {
		return !0;
	}
	update(e) {
		this._$Eq &&= this._$Eq.forEach((e) => this._$ET(e, this[e])), this._$EM();
	}
	updated(e) {}
	firstUpdated(e) {}
};
ae.elementStyles = [], ae.shadowRootOptions = { mode: "open" }, ae[C("elementProperties")] = /* @__PURE__ */ new Map(), ae[C("finalized")] = /* @__PURE__ */ new Map(), re?.({ ReactiveElement: ae }), (ee.reactiveElementVersions ??= []).push("2.1.2");
// node_modules/lit-html/lit-html.js
var oe = globalThis, se = (e) => e, ce = oe.trustedTypes, le = ce ? ce.createPolicy("lit-html", { createHTML: (e) => e }) : void 0, ue = "$lit$", E = `lit$${Math.random().toFixed(9).slice(2)}$`, de = "?" + E, fe = `<${de}>`, pe = document, me = () => pe.createComment(""), he = (e) => e === null || typeof e != "object" && typeof e != "function", ge = Array.isArray, _e = (e) => ge(e) || typeof e?.[Symbol.iterator] == "function", ve = "[ 	\n\f\r]", ye = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g, be = /-->/g, xe = />/g, Se = RegExp(`>|${ve}(?:([^\\s"'>=/]+)(${ve}*=${ve}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`, "g"), Ce = /'/g, we = /"/g, Te = /^(?:script|style|textarea|title)$/i, Ee = ((e) => (t, ...n) => ({
	_$litType$: e,
	strings: t,
	values: n
}))(1), De = Symbol.for("lit-noChange"), D = Symbol.for("lit-nothing"), Oe = /* @__PURE__ */ new WeakMap(), ke = pe.createTreeWalker(pe, 129);
function Ae(e, t) {
	if (!ge(e) || !e.hasOwnProperty("raw")) throw Error("invalid template strings array");
	return le === void 0 ? t : le.createHTML(t);
}
var je = (e, t) => {
	let n = e.length - 1, r = [], i, a = t === 2 ? "<svg>" : t === 3 ? "<math>" : "", o = ye;
	for (let t = 0; t < n; t++) {
		let n = e[t], s, c, l = -1, u = 0;
		for (; u < n.length && (o.lastIndex = u, c = o.exec(n), c !== null);) u = o.lastIndex, o === ye ? c[1] === "!--" ? o = be : c[1] === void 0 ? c[2] === void 0 ? c[3] !== void 0 && (o = Se) : (Te.test(c[2]) && (i = RegExp("</" + c[2], "g")), o = Se) : o = xe : o === Se ? c[0] === ">" ? (o = i ?? ye, l = -1) : c[1] === void 0 ? l = -2 : (l = o.lastIndex - c[2].length, s = c[1], o = c[3] === void 0 ? Se : c[3] === "\"" ? we : Ce) : o === we || o === Ce ? o = Se : o === be || o === xe ? o = ye : (o = Se, i = void 0);
		let d = o === Se && e[t + 1].startsWith("/>") ? " " : "";
		a += o === ye ? n + fe : l >= 0 ? (r.push(s), n.slice(0, l) + ue + n.slice(l) + E + d) : n + E + (l === -2 ? t : d);
	}
	return [Ae(e, a + (e[n] || "<?>") + (t === 2 ? "</svg>" : t === 3 ? "</math>" : "")), r];
}, Me = class e {
	constructor({ strings: t, _$litType$: n }, r) {
		let i;
		this.parts = [];
		let a = 0, o = 0, s = t.length - 1, c = this.parts, [l, u] = je(t, n);
		if (this.el = e.createElement(l, r), ke.currentNode = this.el.content, n === 2 || n === 3) {
			let e = this.el.content.firstChild;
			e.replaceWith(...e.childNodes);
		}
		for (; (i = ke.nextNode()) !== null && c.length < s;) {
			if (i.nodeType === 1) {
				if (i.hasAttributes()) for (let e of i.getAttributeNames()) if (e.endsWith(ue)) {
					let t = u[o++], n = i.getAttribute(e).split(E), r = /([.?@])?(.*)/.exec(t);
					c.push({
						type: 1,
						index: a,
						name: r[2],
						strings: n,
						ctor: r[1] === "." ? Le : r[1] === "?" ? Re : r[1] === "@" ? ze : Ie
					}), i.removeAttribute(e);
				} else e.startsWith(E) && (c.push({
					type: 6,
					index: a
				}), i.removeAttribute(e));
				if (Te.test(i.tagName)) {
					let e = i.textContent.split(E), t = e.length - 1;
					if (t > 0) {
						i.textContent = ce ? ce.emptyScript : "";
						for (let n = 0; n < t; n++) i.append(e[n], me()), ke.nextNode(), c.push({
							type: 2,
							index: ++a
						});
						i.append(e[t], me());
					}
				}
			} else if (i.nodeType === 8) {
				if (i.data === de) c.push({
					type: 2,
					index: a
				});
				else {
					let e = -1;
					for (; (e = i.data.indexOf(E, e + 1)) !== -1;) c.push({
						type: 7,
						index: a
					}), e += E.length - 1;
				}
			}
			a++;
		}
	}
	static createElement(e, t) {
		let n = pe.createElement("template");
		return n.innerHTML = e, n;
	}
};
function Ne(e, t, n = e, r) {
	if (t === De) return t;
	let i = r === void 0 ? n._$Cl : n._$Co?.[r], a = he(t) ? void 0 : t._$litDirective$;
	return i?.constructor !== a && (i?._$AO?.(!1), a === void 0 ? i = void 0 : (i = new a(e), i._$AT(e, n, r)), r === void 0 ? n._$Cl = i : (n._$Co ??= [])[r] = i), i !== void 0 && (t = Ne(e, i._$AS(e, t.values), i, r)), t;
}
var Pe = class {
	constructor(e, t) {
		this._$AV = [], this._$AN = void 0, this._$AD = e, this._$AM = t;
	}
	get parentNode() {
		return this._$AM.parentNode;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	u(e) {
		let { el: { content: t }, parts: n } = this._$AD, r = (e?.creationScope ?? pe).importNode(t, !0);
		ke.currentNode = r;
		let i = ke.nextNode(), a = 0, o = 0, s = n[0];
		for (; s !== void 0;) {
			if (a === s.index) {
				let t;
				s.type === 2 ? t = new Fe(i, i.nextSibling, this, e) : s.type === 1 ? t = new s.ctor(i, s.name, s.strings, this, e) : s.type === 6 && (t = new Be(i, this, e)), this._$AV.push(t), s = n[++o];
			}
			a !== s?.index && (i = ke.nextNode(), a++);
		}
		return ke.currentNode = pe, r;
	}
	p(e) {
		let t = 0;
		for (let n of this._$AV) n !== void 0 && (n.strings === void 0 ? n._$AI(e[t]) : (n._$AI(e, n, t), t += n.strings.length - 2)), t++;
	}
}, Fe = class e {
	get _$AU() {
		return this._$AM?._$AU ?? this._$Cv;
	}
	constructor(e, t, n, r) {
		this.type = 2, this._$AH = D, this._$AN = void 0, this._$AA = e, this._$AB = t, this._$AM = n, this.options = r, this._$Cv = r?.isConnected ?? !0;
	}
	get parentNode() {
		let e = this._$AA.parentNode, t = this._$AM;
		return t !== void 0 && e?.nodeType === 11 && (e = t.parentNode), e;
	}
	get startNode() {
		return this._$AA;
	}
	get endNode() {
		return this._$AB;
	}
	_$AI(e, t = this) {
		e = Ne(this, e, t), he(e) ? e === D || e == null || e === "" ? (this._$AH !== D && this._$AR(), this._$AH = D) : e !== this._$AH && e !== De && this._(e) : e._$litType$ === void 0 ? e.nodeType === void 0 ? _e(e) ? this.k(e) : this._(e) : this.T(e) : this.$(e);
	}
	O(e) {
		return this._$AA.parentNode.insertBefore(e, this._$AB);
	}
	T(e) {
		this._$AH !== e && (this._$AR(), this._$AH = this.O(e));
	}
	_(e) {
		this._$AH !== D && he(this._$AH) ? this._$AA.nextSibling.data = e : this.T(pe.createTextNode(e)), this._$AH = e;
	}
	$(e) {
		let { values: t, _$litType$: n } = e, r = typeof n == "number" ? this._$AC(e) : (n.el === void 0 && (n.el = Me.createElement(Ae(n.h, n.h[0]), this.options)), n);
		if (this._$AH?._$AD === r) this._$AH.p(t);
		else {
			let e = new Pe(r, this), n = e.u(this.options);
			e.p(t), this.T(n), this._$AH = e;
		}
	}
	_$AC(e) {
		let t = Oe.get(e.strings);
		return t === void 0 && Oe.set(e.strings, t = new Me(e)), t;
	}
	k(t) {
		ge(this._$AH) || (this._$AH = [], this._$AR());
		let n = this._$AH, r, i = 0;
		for (let a of t) i === n.length ? n.push(r = new e(this.O(me()), this.O(me()), this, this.options)) : r = n[i], r._$AI(a), i++;
		i < n.length && (this._$AR(r && r._$AB.nextSibling, i), n.length = i);
	}
	_$AR(e = this._$AA.nextSibling, t) {
		for (this._$AP?.(!1, !0, t); e !== this._$AB;) {
			let t = se(e).nextSibling;
			se(e).remove(), e = t;
		}
	}
	setConnected(e) {
		this._$AM === void 0 && (this._$Cv = e, this._$AP?.(e));
	}
}, Ie = class {
	get tagName() {
		return this.element.tagName;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	constructor(e, t, n, r, i) {
		this.type = 1, this._$AH = D, this._$AN = void 0, this.element = e, this.name = t, this._$AM = r, this.options = i, n.length > 2 || n[0] !== "" || n[1] !== "" ? (this._$AH = Array(n.length - 1).fill(/* @__PURE__ */ new String()), this.strings = n) : this._$AH = D;
	}
	_$AI(e, t = this, n, r) {
		let i = this.strings, a = !1;
		if (i === void 0) e = Ne(this, e, t, 0), a = !he(e) || e !== this._$AH && e !== De, a && (this._$AH = e);
		else {
			let r = e, o, s;
			for (e = i[0], o = 0; o < i.length - 1; o++) s = Ne(this, r[n + o], t, o), s === De && (s = this._$AH[o]), a ||= !he(s) || s !== this._$AH[o], s === D ? e = D : e !== D && (e += (s ?? "") + i[o + 1]), this._$AH[o] = s;
		}
		a && !r && this.j(e);
	}
	j(e) {
		e === D ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, e ?? "");
	}
}, Le = class extends Ie {
	constructor() {
		super(...arguments), this.type = 3;
	}
	j(e) {
		this.element[this.name] = e === D ? void 0 : e;
	}
}, Re = class extends Ie {
	constructor() {
		super(...arguments), this.type = 4;
	}
	j(e) {
		this.element.toggleAttribute(this.name, !!e && e !== D);
	}
}, ze = class extends Ie {
	constructor(e, t, n, r, i) {
		super(e, t, n, r, i), this.type = 5;
	}
	_$AI(e, t = this) {
		if ((e = Ne(this, e, t, 0) ?? D) === De) return;
		let n = this._$AH, r = e === D && n !== D || e.capture !== n.capture || e.once !== n.once || e.passive !== n.passive, i = e !== D && (n === D || r);
		r && this.element.removeEventListener(this.name, this, n), i && this.element.addEventListener(this.name, this, e), this._$AH = e;
	}
	handleEvent(e) {
		typeof this._$AH == "function" ? this._$AH.call(this.options?.host ?? this.element, e) : this._$AH.handleEvent(e);
	}
}, Be = class {
	constructor(e, t, n) {
		this.element = e, this.type = 6, this._$AN = void 0, this._$AM = t, this.options = n;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	_$AI(e) {
		Ne(this, e);
	}
}, Ve = oe.litHtmlPolyfillSupport;
Ve?.(Me, Fe), (oe.litHtmlVersions ??= []).push("3.3.3");
var He = (e, t, n) => {
	let r = n?.renderBefore ?? t, i = r._$litPart$;
	if (i === void 0) {
		let e = n?.renderBefore ?? null;
		r._$litPart$ = i = new Fe(t.insertBefore(me(), e), e, void 0, n ?? {});
	}
	return i._$AI(e), i;
}, Ue = globalThis, We = class extends ae {
	constructor() {
		super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
	}
	createRenderRoot() {
		let e = super.createRenderRoot();
		return this.renderOptions.renderBefore ??= e.firstChild, e;
	}
	update(e) {
		let t = this.render();
		this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(e), this._$Do = He(t, this.renderRoot, this.renderOptions);
	}
	connectedCallback() {
		super.connectedCallback(), this._$Do?.setConnected(!0);
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._$Do?.setConnected(!1);
	}
	render() {
		return De;
	}
};
We._$litElement$ = !0, We.finalized = !0, Ue.litElementHydrateSupport?.({ LitElement: We });
var Ge = Ue.litElementPolyfillSupport;
Ge?.({ LitElement: We }), (Ue.litElementVersions ??= []).push("4.2.2");
// node_modules/@lit/reactive-element/decorators/custom-element.js
var Ke = (e) => (t, n) => {
	n === void 0 ? customElements.define(e, t) : n.addInitializer(() => {
		customElements.define(e, t);
	});
}, qe = {
	attribute: !0,
	type: String,
	converter: w,
	reflect: !1,
	hasChanged: T
}, Je = (e = qe, t, n) => {
	let { kind: r, metadata: i } = n, a = globalThis.litPropertyMetadata.get(i);
	if (a === void 0 && globalThis.litPropertyMetadata.set(i, a = /* @__PURE__ */ new Map()), r === "setter" && ((e = Object.create(e)).wrapped = !0), a.set(n.name, e), r === "accessor") {
		let { name: r } = n;
		return {
			set(n) {
				let i = t.get.call(this);
				t.set.call(this, n), this.requestUpdate(r, i, e, !0, n);
			},
			init(t) {
				return t !== void 0 && this.C(r, void 0, e, t), t;
			}
		};
	}
	if (r === "setter") {
		let { name: r } = n;
		return function(n) {
			let i = this[r];
			t.call(this, n), this.requestUpdate(r, i, e, !0, n);
		};
	}
	throw Error("Unsupported decorator location: " + r);
};
function O(e) {
	return (t, n) => typeof n == "object" ? Je(e, t, n) : ((e, t, n) => {
		let r = t.hasOwnProperty(n);
		return t.constructor.createProperty(n, e), r ? Object.getOwnPropertyDescriptor(t, n) : void 0;
	})(e, t, n);
}
// node_modules/@lit/reactive-element/decorators/base.js
var Ye = (e, t, n) => (n.configurable = !0, n.enumerable = !0, Reflect.decorate && typeof t != "object" && Object.defineProperty(e, t, n), n);
// node_modules/@lit/reactive-element/decorators/query.js
function Xe(e, t) {
	return (n, r, i) => {
		let a = (t) => t.renderRoot?.querySelector(e) ?? null;
		if (t) {
			let { get: e, set: t } = typeof r == "object" ? n : i ?? (() => {
				let e = Symbol();
				return {
					get() {
						return this[e];
					},
					set(t) {
						this[e] = t;
					}
				};
			})();
			return Ye(n, r, { get() {
				let n = e.call(this);
				return n === void 0 && (n = a(this), (n !== null || this.hasUpdated) && t.call(this, n)), n;
			} });
		}
		return Ye(n, r, { get() {
			return a(this);
		} });
	};
}
// node_modules/@formdown/core/dist/options.js
function Ze(e, t, n = Infinity) {
	let r = [], i = "";
	for (let a = 0; a < e.length; a++) {
		let o = e[a];
		o === "\\" && a + 1 < e.length ? i += o + e[++a] : o === t && r.length < n - 1 ? (r.push(i), i = "") : i += o;
	}
	return r.push(i), r;
}
function Qe(e) {
	return e.replace(/\\([\\,=])/g, "$1");
}
function $e(e) {
	let t = e.trim(), [n, r] = Ze(t, "=", 2);
	if (r !== void 0) {
		let e = Qe(n.trim()), t = Qe(r.trim());
		if (e && t) return e === t ? { value: e } : {
			value: e,
			label: t
		};
	}
	return { value: Qe(t) };
}
function et(e) {
	let t = {
		options: [],
		allowOther: !1
	};
	for (let n of Ze(e, ",").map((e) => e.trim()).filter((e) => e.length > 0)) if (n === "*") t.allowOther = !0;
	else if (n.startsWith("*(") && n.endsWith(")")) {
		if (!t.allowOther) {
			t.allowOther = !0;
			let e = Qe(n.slice(2, -1));
			e !== "Other" && (t.otherLabel = e);
		}
	} else t.options.push($e(n));
	return t;
}
function tt(e) {
	return e.label ?? e.value;
}
function nt(e) {
	let t = (e) => e.replace(/[\\,=]/g, "\\$&"), n = (e) => e.replace(/[\\,]/g, "\\$&");
	return e.map((e) => e.label !== void 0 && e.label !== e.value ? `${t(e.value)}=${n(e.label)}` : t(e.value)).join(",");
}
// node_modules/@formdown/core/dist/suggest.js
var rt = "suggest:", it = ["judged", "observed"], at = [
	"offer",
	"confirm",
	"off"
], ot = [
	"role",
	"policy",
	"evidence",
	"parent",
	"coarse",
	"must-catch"
];
function st(e, t) {
	let n = new Set(e.map((e) => e.name));
	for (let r of e) {
		let e = ct(r, n, t);
		e && (r.suggest = e);
	}
}
function ct(e, t, n) {
	let r = e.attributes;
	if (!r) return;
	let i = {}, a = {
		field: e.name,
		...e.span && { span: e.span }
	}, o = (t, r, i) => n({
		code: "suggest-invalid",
		message: `"${e.name}" has ${rt}${t}=${JSON.stringify(r)}, which is not ${i}: it is ignored`,
		...a
	});
	for (let [s, c] of Object.entries(r)) {
		if (!s.startsWith(rt)) continue;
		delete r[s];
		let l = s.slice(8);
		switch (l) {
			case "role":
				lt(c, it) ? i.role = c : o(l, c, "judged or observed");
				break;
			case "policy":
				lt(c, at) ? i.policy = c : o(l, c, "offer, confirm or off");
				break;
			case "evidence": {
				let e = c === !0 || c === "true" ? !0 : c === !1 || c === "false" ? !1 : void 0;
				e === void 0 ? o(l, c, "true or false") : i.evidence = e;
				break;
			}
			case "parent":
				typeof c != "string" || c === "" || c === e.name ? o(l, c, "the name of another field") : t.has(c) ? i.parent = c : n({
					code: "suggest-parent-unknown",
					message: `"${e.name}" depends on "${c}" (${rt}parent), which is not a field of this form: it is ignored`,
					related: c,
					...a
				});
				break;
			case "coarse": {
				let e = typeof c == "number" ? c : typeof c == "string" && /^\d+$/.test(c) ? Number(c) : NaN;
				Number.isInteger(e) && e >= 1 ? i.coarse = e : o(l, c, "a whole number of characters from 1");
				break;
			}
			case "must-catch": {
				let t = typeof c == "string" || typeof c == "number" ? String(c).split(",").map((e) => e.trim()).filter((e) => e !== "") : [];
				if (t.length === 0) {
					o(l, c, "a list of values");
					break;
				}
				let r = e.options?.length ? new Set(e.options.map((e) => e.value)) : void 0, s = r ? t.filter((e) => r.has(e)) : t;
				for (let r of t.filter((e) => !s.includes(e))) n({
					code: "suggest-must-catch-unlisted",
					message: `"${e.name}" names "${r}" as a value not to miss (${rt}must-catch), but it is not one of its options: it is ignored`,
					related: r,
					...a
				});
				s.length && (i.mustCatch = s);
				break;
			}
			default: n({
				code: "suggest-unknown",
				message: `"${e.name}" has ${s}, which formdown does not know (${ot.map((e) => rt + e).join(", ")}): it is ignored`,
				...a
			});
		}
	}
	return i.role === "observed" && (i.policy === "offer" || i.policy === "confirm") && (n({
		code: "suggest-policy-on-observed",
		message: `"${e.name}" is observed, so ${rt}policy=${i.policy} has nothing to suggest: it is ignored`,
		...a
	}), delete i.policy), Object.keys(i).length ? i : void 0;
}
function lt(e, t) {
	return typeof e == "string" && t.includes(e);
}
// node_modules/@formdown/core/dist/grammar.js
var k = String.raw`[\p{L}_][\p{L}\p{N}_]*`, ut = String.raw`[\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?`, dt = String.raw`\(((?:[^()]|\([^()]*\))+)\)`, ft = String.raw`\((?:[^()]|\([^()]*\))*\)`, pt = RegExp(`^${k}$`, "u"), mt = {
	"visible-if": "visibleIf",
	"hidden-if": "hiddenIf",
	"enabled-if": "enabledIf",
	"disabled-if": "disabledIf",
	"required-if": "requiredIf"
}, ht = (e) => e && e.charAt(0).toUpperCase() + e.slice(1).toLowerCase();
function gt(e) {
	return e.includes("_") ? e.split("_").map(ht).join(" ") : /[a-z][A-Z]/.test(e) ? e.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ").map(ht).join(" ") : ht(e);
}
function _t(e) {
	return pt.test(e);
}
var vt = String.raw`\[((?:[^\]"'\\]|\\.|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\]`;
function yt(e) {
	let t = [], n = 0;
	for (; n < e.length;) {
		for (; n < e.length && /\s/.test(e[n]);) n++;
		if (n >= e.length) break;
		let r = n, i = "";
		for (; n < e.length && !/[\s="']/.test(e[n]);) i += e[n++];
		if (!i) {
			n++;
			continue;
		}
		if (e[n] !== "=") {
			t.push({
				key: i,
				quoted: !1,
				start: r,
				end: n
			});
			continue;
		}
		n++;
		let a = e[n];
		if (a === "\"" || a === "'") {
			let o = "";
			for (n++; n < e.length && e[n] !== a;) if (e[n] === "\\" && n + 1 < e.length) {
				let t = e[n + 1];
				o += t === a || t === "\\" ? t : e[n] + t, n += 2;
			} else o += e[n++];
			n = Math.min(n + 1, e.length), t.push({
				key: i,
				value: o,
				quoted: !0,
				start: r,
				end: n
			});
		} else {
			let a = "";
			for (; n < e.length && !/\s/.test(e[n]);) a += e[n++];
			t.push({
				key: i,
				value: a,
				quoted: !1,
				start: r,
				end: n
			});
		}
	}
	return t;
}
function bt(e) {
	return e.value === void 0 ? !0 : e.quoted ? e.value : /^-?\d+$/.test(e.value) ? parseInt(e.value, 10) : /^-?\d*\.\d+$/.test(e.value) ? parseFloat(e.value) : e.value === "true" || e.value !== "false" && e.value;
}
function xt(e) {
	return `"${e.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}
function St(e, t) {
	let n = null;
	for (let r = t + 1; r < e.length; r++) {
		let t = e[r];
		if (t === "\\") r++;
		else if (n) t === n && (n = null);
		else if (t === "\"" || t === "'") n = t;
		else if (t === "]") return { end: r + 1 };
	}
	return { error: n ? "unterminated-quoted-value" : "unterminated-attributes" };
}
function A(e, t = "") {
	return new RegExp(e, t.includes("u") ? t : t + "u");
}
// node_modules/@formdown/core/dist/source.js
var Ct = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/;
function wt(e) {
	let t = e.match(Ct);
	return t ? {
		raw: t[1] ?? "",
		span: {
			start: 0,
			end: t[0].length,
			line: 1,
			column: 1
		},
		lineCount: t[0].split("\n").length
	} : null;
}
var Tt = /^ {0,3}(`{3,}|~{3,})/, Et = class {
	constructor() {
		this.fence = null;
	}
	next(e) {
		let t = e.match(Tt)?.[1];
		return this.fence === null ? t && !(t[0] === "`" && e.slice(e.indexOf(t) + t.length).includes("`")) ? (this.fence = t, !0) : !1 : (t && t[0] === this.fence[0] && t.length >= this.fence.length && e.trim() === t && (this.fence = null), !0);
	}
}, Dt = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, Ot = ["", ""], kt = /+|+/g;
function At(e) {
	let t = [], n = e.replace(Dt, (e) => (t.push(e), Ot[(t.length - 1) % 2].repeat(e.length))), r = 0;
	return {
		masked: n,
		restore: (e) => t.length === 0 ? e : e.replace(kt, () => t[r++])
	};
}
// node_modules/@formdown/core/dist/extensions/hooks.js
function jt(e) {
	return Array.isArray(e) ? "array" : e === null ? "null" : typeof e;
}
function Mt(e) {
	return /^[aeiou]/.test(e) ? `an ${e}` : `a ${e}`;
}
var Nt = class {
	constructor(e = {}, t) {
		this.options = e, this.hooks = /* @__PURE__ */ new Map(), this.eventEmitter = t;
	}
	register(e) {
		let t = this.hooks.get(e.name) || [];
		t.push(e), t.sort((e, t) => t.priority - e.priority), this.hooks.set(e.name, t), this.emit("hook-registered", {
			hook: e.name,
			priority: e.priority
		}), this.options.debug && console.debug(`[Formdown] Hook registered: ${e.name} (priority: ${e.priority})`);
	}
	unregister(e, t) {
		let n = this.hooks.get(e) || [], r = n.filter((e) => e.handler !== t);
		r.length !== n.length && (this.hooks.set(e, r), this.emit("hook-unregistered", { hook: e }), this.options.debug && console.debug(`[Formdown] Hook unregistered: ${e}`));
	}
	async execute(e, t, ...n) {
		let r = this.hooks.get(e) || [], i = [];
		this.emit("hooks-executing", {
			hook: e,
			count: r.length
		});
		for (let a of r) {
			let r = null;
			try {
				r = this.options.timeout ? this.createTimeoutPromise(this.options.timeout) : null;
				let o = Promise.resolve(a.handler(t, ...n)), s = r ? await Promise.race([o, r.promise]) : await o;
				r?.cleanup(), s !== void 0 && i.push(s), this.emit("hook-executed", {
					hook: e,
					success: !0
				});
			} catch (t) {
				r?.cleanup(), this.handleHookError(e, t);
			}
		}
		return this.emit("hooks-completed", {
			hook: e,
			results: i.length
		}), i;
	}
	executeSync(e, t, ...n) {
		let r = this.hooks.get(e) || [], i = [];
		this.emit("hooks-executing", {
			hook: e,
			count: r.length
		});
		for (let a of r) try {
			let r = a.handler(t, ...n);
			r !== void 0 && i.push(r), this.emit("hook-executed", {
				hook: e,
				success: !0
			});
		} catch (t) {
			this.handleHookError(e, t);
		}
		return this.emit("hooks-completed", {
			hook: e,
			results: i.length
		}), i;
	}
	transformSync(e, t, n, r) {
		for (let i of this.hooks.get(e) || []) try {
			let e = i.handler(t, n);
			if (e instanceof Promise) throw e.catch(() => void 0), Error("asynchronous hooks cannot run during synchronous parsing or generation");
			if (e !== void 0) {
				let t = jt(n), r = jt(e);
				if (n != null && r !== t) throw Error(`returned ${Mt(r)} where ${Mt(t)} was expected`);
				n = e;
			}
		} catch (t) {
			let n = `Hook "${e}" failed: ${t instanceof Error ? t.message : String(t)}`;
			this.emit("hook-error", {
				hook: e,
				error: n
			}), r?.(n);
		}
		return n;
	}
	clear(e) {
		e ? (this.hooks.delete(e), this.emit("hooks-cleared", { hook: e })) : (this.hooks.clear(), this.emit("hooks-cleared", { all: !0 })), this.options.debug && console.debug(`[Formdown] Hooks cleared: ${e || "all"}`);
	}
	getHooks(e) {
		return [...this.hooks.get(e) || []];
	}
	getHookNames() {
		return Array.from(this.hooks.keys());
	}
	getHookCount() {
		return Array.from(this.hooks.values()).reduce((e, t) => e + t.length, 0);
	}
	createTimeoutPromise(e) {
		let t;
		return {
			promise: new Promise((n, r) => {
				t = setTimeout(() => {
					r(/* @__PURE__ */ Error(`Hook execution timeout after ${e}ms`));
				}, e);
			}),
			cleanup: () => {
				clearTimeout(t);
			}
		};
	}
	handleHookError(e, t) {
		let n = `Hook execution failed: ${e} - ${t.message || t}`;
		switch (this.emit("hook-error", {
			hook: e,
			error: n
		}), this.options.errorStrategy) {
			case "ignore": break;
			case "warn":
				console.warn(`[Formdown] ${n}`);
				break;
			default: throw Error(n);
		}
	}
	emit(e, t) {
		this.eventEmitter?.emit(e, t);
	}
}, Pt = class {
	constructor(e, t = {}, n, r) {
		this.hookManager = e, this.options = t, this.eventEmitter = n, this.fieldTypeRegistry = r, this.plugins = /* @__PURE__ */ new Map(), this.fieldTypes = /* @__PURE__ */ new Map(), this.initialized = !1;
	}
	async register(e) {
		if (this.plugins.has(e.metadata.name)) throw Error(`Plugin '${e.metadata.name}' is already registered`);
		await this.validateDependencies(e);
		let t = (e.fieldTypes ?? []).map((e) => e.type);
		for (let [e, n] of t.entries()) if (this.fieldTypes.has(n) || this.fieldTypeRegistry?.has(n) || t.indexOf(n) !== e) throw Error(`Field type '${n}' is already registered`);
		if (this.plugins.set(e.metadata.name, e), e.hooks) for (let t of e.hooks) this.hookManager.register(t);
		if (e.fieldTypes) for (let t of e.fieldTypes) this.fieldTypes.set(t.type, t), this.fieldTypeRegistry?.register(t);
		if (this.emit("plugin-registered", {
			plugin: e.metadata.name,
			version: e.metadata.version
		}), this.options.debug && console.debug(`[Formdown] Plugin registered: ${e.metadata.name} v${e.metadata.version}`), this.initialized && e.initialize) try {
			await e.initialize(), this.emit("plugin-initialized", { plugin: e.metadata.name });
		} catch (t) {
			this.handlePluginError(e.metadata.name, "initialization", t);
		}
	}
	async unregister(e) {
		let t = this.plugins.get(e);
		if (t) {
			if (t.destroy) try {
				await t.destroy(), this.emit("plugin-destroyed", { plugin: e });
			} catch (t) {
				this.handlePluginError(e, "cleanup", t);
			}
			if (t.hooks) for (let e of t.hooks) this.hookManager.unregister(e.name, e.handler);
			if (t.fieldTypes) for (let e of t.fieldTypes) this.fieldTypes.delete(e.type), this.fieldTypeRegistry?.unregister(e.type);
			this.plugins.delete(e), this.emit("plugin-unregistered", { plugin: e }), this.options.debug && console.debug(`[Formdown] Plugin unregistered: ${e}`);
		}
	}
	get(e) {
		return this.plugins.get(e);
	}
	getAll() {
		return Array.from(this.plugins.values());
	}
	isRegistered(e) {
		return this.plugins.has(e);
	}
	async initialize() {
		if (this.initialized) return;
		this.emit("plugins-initializing", { count: this.plugins.size });
		let e = [];
		for (let t of this.plugins.values()) t.initialize && e.push(Promise.resolve(t.initialize()).catch((e) => this.handlePluginError(t.metadata.name, "initialization", e)));
		await Promise.all(e), this.initialized = !0, this.emit("plugins-initialized", { count: this.plugins.size }), this.options.debug && console.debug(`[Formdown] ${this.plugins.size} plugins initialized`);
	}
	async destroy() {
		if (!this.initialized) return;
		this.emit("plugins-destroying", { count: this.plugins.size });
		let e = [];
		for (let t of this.plugins.values()) t.destroy && e.push(Promise.resolve(t.destroy()).catch((e) => this.handlePluginError(t.metadata.name, "cleanup", e)));
		await Promise.all(e);
		for (let e of this.fieldTypes.keys()) this.fieldTypeRegistry?.unregister(e);
		this.plugins.clear(), this.fieldTypes.clear(), this.initialized = !1, this.emit("plugins-destroyed", { count: 0 }), this.options.debug && console.debug("[Formdown] All plugins destroyed and cleared");
	}
	getFieldTypes() {
		return new Map(this.fieldTypes);
	}
	getFieldType(e) {
		return this.fieldTypes.get(e);
	}
	hasFieldType(e) {
		return this.fieldTypes.has(e);
	}
	async validateDependencies(e) {
		if (e.metadata.dependencies) {
			for (let t of e.metadata.dependencies) if (!this.isRegistered(t)) throw Error(`Plugin '${e.metadata.name}' requires dependency '${t}' which is not registered`);
		}
	}
	handlePluginError(e, t, n) {
		let r = `Plugin ${t} failed: ${e} - ${n.message || n}`;
		switch (this.emit("plugin-error", {
			plugin: e,
			operation: t,
			error: r
		}), this.options.errorStrategy) {
			case "ignore": break;
			case "warn":
				console.warn(`[Formdown] ${r}`);
				break;
			default: throw Error(r);
		}
	}
	emit(e, t) {
		this.eventEmitter && this.eventEmitter.emit(e, t);
	}
}, Ft = class {
	constructor() {
		this.listeners = /* @__PURE__ */ new Map();
	}
	on(e, t) {
		this.listeners.has(e) || this.listeners.set(e, /* @__PURE__ */ new Set()), this.listeners.get(e).add(t);
	}
	off(e, t) {
		let n = this.listeners.get(e);
		n && (n.delete(t), n.size === 0 && this.listeners.delete(e));
	}
	emit(e, t) {
		let n = this.listeners.get(e);
		if (!n) return;
		let r = {
			type: e,
			data: t,
			timestamp: Date.now()
		};
		for (let t of n) try {
			t(r);
		} catch (t) {
			console.error(`[Formdown] Event listener error in '${e}':`, t);
		}
	}
	once(e, t) {
		let n = (e) => {
			t(e), this.off(e.type, n);
		};
		this.on(e, n);
	}
	removeAllListeners(e) {
		e ? this.listeners.delete(e) : this.listeners.clear();
	}
	listenerCount(e) {
		return this.listeners.get(e)?.size || 0;
	}
	eventNames() {
		return Array.from(this.listeners.keys());
	}
}, It = class {
	constructor() {
		this.fieldTypes = /* @__PURE__ */ new Map(), this.styleCache = /* @__PURE__ */ new Map();
	}
	register(e) {
		if (this.fieldTypes.has(e.type)) throw Error(`Field type '${e.type}' is already registered`);
		this.fieldTypes.set(e.type, e), e.styles && this.styleCache.set(e.type, e.styles);
	}
	unregister(e) {
		this.fieldTypes.delete(e), this.styleCache.delete(e);
	}
	get(e) {
		return this.fieldTypes.get(e);
	}
	has(e) {
		return this.fieldTypes.has(e);
	}
	getAll() {
		return new Map(this.fieldTypes);
	}
	parseField(e, t) {
		for (let n of this.fieldTypes.values()) if (n.parser) {
			let r = n.parser(e, t);
			if (r) return n.defaultAttributes && (r.attributes = {
				...n.defaultAttributes,
				...r.attributes
			}), r;
		}
		return null;
	}
	generateFieldHTML(e, t) {
		let n = this.fieldTypes.get(e.type);
		return n?.generator ? n.generator(e, t) : null;
	}
	validate(e, t) {
		let n = t.type ? this.fieldTypes.get(t.type) : void 0;
		return n?.validator ? n.validator(e, t) : [];
	}
	getAllStyles() {
		return Array.from(this.styleCache.values()).join("\n");
	}
	getStylesForTypes(e) {
		return e.map((e) => this.styleCache.get(e)).filter(Boolean).join("\n");
	}
	getStats() {
		return {
			registeredTypes: Array.from(this.fieldTypes.keys()),
			totalTypes: this.fieldTypes.size,
			typesWithStyles: Array.from(this.styleCache.keys())
		};
	}
	clear() {
		this.fieldTypes.clear(), this.styleCache.clear();
	}
};
new It();
// node_modules/@formdown/core/dist/extensions/built-in-plugins.js
var Lt = {
	metadata: {
		name: "formdown-core",
		version: "1.0.0",
		description: "Field types Formdown adds through its extension system",
		author: "Formdown Team"
	},
	fieldTypes: []
}, Rt = class {
	constructor(e = {}) {
		this.initialized = !1;
		let t = {
			timeout: 1e3,
			errorStrategy: "warn",
			debug: !1,
			...e
		};
		this.eventEmitter = new Ft(), this.hookManager = new Nt(t, this.eventEmitter), this.fieldTypeRegistry = new It(), this.pluginManager = new Pt(this.hookManager, t, this.eventEmitter, this.fieldTypeRegistry), this.context = {
			hooks: this.hookManager,
			plugins: this.pluginManager,
			fieldTypes: this.fieldTypeRegistry,
			options: t
		}, this.setupErrorHandling();
	}
	initialize() {
		return this.initialized ? Promise.resolve() : (this.initializing ??= this.runInitialize().finally(() => {
			this.initializing = void 0;
		}), this.initializing);
	}
	async runInitialize() {
		this.eventEmitter.emit("extension-system-initializing");
		try {
			await this.pluginManager.register(Lt), await this.pluginManager.initialize(), this.initialized = !0, this.eventEmitter.emit("extension-system-initialized"), this.context.options.debug && console.debug("[Formdown] Extension system initialized");
		} catch (e) {
			throw this.eventEmitter.emit("extension-system-error", {
				phase: "initialization",
				error: e instanceof Error ? e.message : String(e)
			}), e;
		}
	}
	async destroy() {
		if (this.initialized) {
			this.eventEmitter.emit("extension-system-destroying");
			try {
				await this.pluginManager.destroy(), this.hookManager.clear(), this.initialized = !1, this.eventEmitter.emit("extension-system-destroyed"), this.eventEmitter.removeAllListeners(), this.setupErrorHandling(), this.context.options.debug && console.debug("[Formdown] Extension system destroyed");
			} catch (e) {
				throw this.eventEmitter.emit("extension-system-error", {
					phase: "destruction",
					error: e instanceof Error ? e.message : String(e)
				}), e;
			}
		}
	}
	async registerPlugin(e) {
		return this.ensureInitialized(), this.pluginManager.register(e);
	}
	async unregisterPlugin(e) {
		return this.ensureInitialized(), this.pluginManager.unregister(e);
	}
	registerHook(e) {
		this.ensureInitialized(), this.hookManager.register(e);
	}
	async executeHooks(e, t, ...n) {
		return this.ensureInitialized(), this.hookManager.execute(e, t, ...n);
	}
	unregisterHook(e, t) {
		this.hookManager.unregister(e, t);
	}
	transformSync(e, t, n, r) {
		return this.initialized ? this.hookManager.transformSync(e, t, n, r) : n;
	}
	executeHooksSync(e, t, ...n) {
		return this.ensureInitialized(), this.hookManager.executeSync(e, t, ...n);
	}
	getContext() {
		return { ...this.context };
	}
	getFieldTypeRegistry() {
		return this.fieldTypeRegistry;
	}
	getEventEmitter() {
		return this.eventEmitter;
	}
	getStats() {
		return {
			initialized: this.initialized,
			plugins: this.pluginManager.getAll().map((e) => ({
				name: e.metadata.name,
				version: e.metadata.version
			})),
			hookCount: this.hookManager.getHookCount(),
			registeredHooks: this.hookManager.getHookNames(),
			fieldTypes: Array.from(this.pluginManager.getFieldTypes().keys())
		};
	}
	enableDebug() {
		this.context.options.debug = !0, console.debug("[Formdown] Debug mode enabled"), console.debug("[Formdown] Extension system stats:", this.getStats());
	}
	disableDebug() {
		this.context.options.debug = !1;
	}
	setupErrorHandling() {
		this.eventEmitter.on("hook-error", (e) => {
			this.context.options.debug && console.error("[Formdown] Hook error:", e.data);
		}), this.eventEmitter.on("plugin-error", (e) => {
			this.context.options.debug && console.error("[Formdown] Plugin error:", e.data);
		}), this.eventEmitter.on("extension-system-error", (e) => {
			console.error("[Formdown] Extension system error:", e.data);
		});
	}
	ensureInitialized() {
		if (!this.initialized) throw Error("Extension system must be initialized before use");
	}
}, zt = null;
function j() {
	return zt ||= new Rt(), zt;
}
async function Bt(e) {
	e && (zt = new Rt(e)), await j().initialize();
}
// node_modules/@formdown/core/dist/escape.js
function M(e) {
	return String(e ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// node_modules/@formdown/core/dist/compute.js
var Vt = A(String.raw`\s*(?:(\d+(?:\.\d+)?)|(${k})|([-+*/()]))`, "y");
function Ht(e) {
	let t = [], n = [];
	Vt.lastIndex = 0;
	let r = 0;
	for (; r < e.length && e.slice(r).trim();) {
		Vt.lastIndex = r;
		let i = Vt.exec(e);
		if (!i) return { error: `cannot read "${e.slice(r).trim()}"` };
		i[1] === void 0 ? i[2] === void 0 ? (t.push(i[3]), n.push("symbol")) : (t.push(i[2]), n.push("name")) : (t.push(Number(i[1])), n.push("number")), r = Vt.lastIndex;
	}
	if (t.length === 0) return { error: "is empty" };
	let i = 0, a = [], o = () => n[i] === "symbol" ? t[i] : void 0;
	function s() {
		let e = c();
		for (let t = o(); t === "+" || t === "-"; t = o()) i++, e = {
			kind: "binary",
			operator: t,
			left: e,
			right: c()
		};
		return e;
	}
	function c() {
		let e = l();
		for (let t = o(); t === "*" || t === "/"; t = o()) i++, e = {
			kind: "binary",
			operator: t,
			left: e,
			right: l()
		};
		return e;
	}
	function l() {
		if (i >= t.length) throw Error("ends too soon");
		let e = t[i], r = n[i++];
		if (r === "number") return {
			kind: "number",
			value: e
		};
		if (r === "name") return a.includes(e) || a.push(e), {
			kind: "field",
			name: e
		};
		if (e === "-") return {
			kind: "negate",
			operand: l()
		};
		if (e === "(") {
			let e = s();
			if (o() !== ")") throw Error("has a \"(\" without its \")\"");
			return i++, e;
		}
		throw Error(`has "${e}" where a number or a field was expected`);
	}
	let u;
	try {
		if (u = s(), i < t.length) throw Error(`has "${t[i]}" after its end`);
	} catch (e) {
		return { error: e.message };
	}
	return {
		fields: a,
		evaluate: (e) => Gt(Ut(u, e))
	};
}
function Ut(e, t) {
	switch (e.kind) {
		case "number": return e.value;
		case "field": return Wt(t[e.name]);
		case "negate": {
			let n = Ut(e.operand, t);
			return n === void 0 ? void 0 : -n;
		}
		case "binary": {
			let n = Ut(e.left, t), r = Ut(e.right, t);
			if (n === void 0 || r === void 0) return;
			switch (e.operator) {
				case "+": return n + r;
				case "-": return n - r;
				case "*": return n * r;
				case "/": return r === 0 ? void 0 : n / r;
			}
		}
	}
}
function Wt(e) {
	if (typeof e == "number") return Number.isFinite(e) ? e : void 0;
	if (typeof e != "string") return;
	let t = e.trim().replace(/,(?=\d{3}\b)/g, "");
	if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
}
function Gt(e) {
	return e === void 0 || !Number.isFinite(e) ? void 0 : Number(e.toPrecision(12));
}
// node_modules/@formdown/core/dist/parser.js
var Kt = String.raw`(?:dt|d|[#@%&t?TrscRFCMW$])`, qt = String.raw`(?:(<->|->)\s*(${ut})\s*)?`, Jt = [
	A(String.raw`^@${k}\*`),
	A(String.raw`^@${k}\{[^}]*\}`),
	A(String.raw`^@${k}\s*:\s*${Kt}\d*\[`),
	A(String.raw`^@${k}${dt}\*`),
	A(String.raw`^@${k}${dt}\{[^}]*\}`),
	A(String.raw`^@${k}${dt}\s*:\s*${Kt}\d*\[`),
	A(String.raw`^@${k}[^:]*(?:<->|->)\s*${ut}\s*:\s*${Kt}\d*\[`)
], Yt = A(String.raw`^@(${k})(?:${dt})?\s*${qt}:\s*${vt}.*$`), Xt = A(String.raw`^@(${k})(\*)?(?:\{(.*?)\})?(?:${dt})?\s*${qt}:\s*(?:(dt|d|[#@%&t?TrscRFCMW$])(\d*)?)?${vt}.*$`), Zt = A(String.raw`^@(${k})(?:${dt})?(\*)?(?:\{(.*?)\})?\s*${qt}:\s*(?:(dt|d|[#@%&t?TrscRFCMW$])(\d*)?)?${vt}.*$`), Qt = [
	"text",
	"email",
	"password",
	"number",
	"tel",
	"url",
	"search",
	"date",
	"time",
	"datetime-local",
	"month",
	"week",
	"color",
	"file",
	"range",
	"radio",
	"checkbox",
	"select",
	"textarea",
	"submit",
	"reset",
	"button",
	"hidden"
], $t = /^@([^\s:([{*\-<>@\]]+)[^:]*:\s*\S*\[/u, en = A(String.raw`^@(${k})(?:${ft})?\*?\s*:\s*(${Qt.join("|")})((?:\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?)*)\s*$`), tn = "", nn = "", rn = /\uE000(\d+)\uE001/g, an = class {
	constructor(e = {}) {
		this.formDeclarations = [], this.datalistDeclarations = [], this.groupDeclarations = [], this.currentFormId = null, this.currentGroupId = null, this.formCounter = 1, this.defaultFormCreated = !1, this.diagnostics = [], this.lineStarts = [], this.currentLine = 0, this.markedInlineFields = [], this.unreadableConditions = [], this.actionCounts = /* @__PURE__ */ new Map(), this.options = {
			preserveMarkdown: !0,
			fieldPrefix: "@",
			inlineFieldDelimiter: "___",
			autoGenerateFormIds: !0,
			...e
		};
	}
	parseFormdown(e) {
		this.formDeclarations = [], this.datalistDeclarations = [], this.groupDeclarations = [], this.currentFormId = null, this.currentGroupId = null, this.formCounter = 1, this.defaultFormCreated = !1, this.diagnostics = [], this.markedInlineFields = [], this.unreadableConditions = [], this.actionCounts = /* @__PURE__ */ new Map();
		let t = (e) => {
			this.diagnostics.push({
				code: "hook-error",
				message: e,
				severity: "error"
			});
		}, n = j().transformSync("pre-parse", { input: e }, e, t), r = this.extractFields(n), i = r.fields.map((e) => j().transformSync("field-parse", {
			input: e.span ? n.slice(e.span.start, e.span.end) : void 0,
			field: e
		}, e, t));
		st(i, (e) => this.diagnostics.push({
			...e,
			severity: "warning"
		})), this.reportDuplicateNames(i), this.reportConditions(i), this.reportComputations(i), this.reportSwitches(i);
		let a = {
			markdown: this.options.preserveMarkdown ? r.cleanedMarkdown : "",
			forms: i,
			...r.frontMatter && { frontMatter: r.frontMatter },
			diagnostics: this.diagnostics,
			formDeclarations: this.formDeclarations,
			datalistDeclarations: this.datalistDeclarations,
			groupDeclarations: this.groupDeclarations
		};
		return j().transformSync("post-parse", { input: n }, a, t);
	}
	extractFields(e) {
		let t = [], n = e.split("\n"), r = [];
		this.lineStarts = [];
		let i = 0;
		for (let e of n) this.lineStarts.push(i), i += e.length + 1;
		let a = wt(e), o = a ? this.readFrontMatter(a.raw, a.span) : void 0, s = a?.lineCount ?? 0, c = new Et();
		for (let e = s; e < n.length; e++) {
			let i = n[e];
			if (this.currentLine = e, c.next(i)) {
				r.push(i);
				continue;
			}
			let a = this.parseFormDeclaration(i);
			if (a) {
				this.formDeclarations.push(a), this.currentFormId = a.id, r.push("");
				continue;
			}
			let o = this.parseDatalistDeclaration(i);
			if (o) {
				this.datalistDeclarations.push(o), r.push("");
				continue;
			}
			let s = this.parseShorthandDatalist(i);
			if (s) {
				this.datalistDeclarations.push(s), r.push("");
				continue;
			}
			let l = this.parseGroupDeclaration(i, e);
			if (l) {
				this.currentGroupId && r.push(`<!--FORMDOWN_GROUP_END_${this.currentGroupId}-->`), this.groupDeclarations.push(l), this.currentGroupId = l.id, r.push(`<!--FORMDOWN_GROUP_START_${l.id}-->`);
				continue;
			}
			if (this.currentGroupId && /^##\s+[^\[]/.test(i) && (r.push(`<!--FORMDOWN_GROUP_END_${this.currentGroupId}-->`), this.currentGroupId = null), i.trim().startsWith("|")) {
				let i = this.parseTableBlock(n, e);
				if (i) {
					i.fields.forEach((e) => this.associateFieldWithForm(e)), t.push(...i.fields), r.push(i.tableHtml), e = i.endIndex;
					continue;
				}
			}
			let u = this.parseBlockField(i);
			if (u) {
				let e = i.trim();
				u.span = this.spanAt(i.indexOf(e), e.length), this.associateFieldWithForm(u), t.push(u), r.push(`<!--FORMDOWN_FIELD_${t.length - 1}-->`);
				continue;
			}
			this.checkBlockFieldSyntax(i);
			let { cleanedLine: d, inlineFields: f } = this.parseInlineFields(i);
			f.forEach((e) => this.associateFieldWithForm(e)), t.push(...f), r.push(d);
		}
		this.currentGroupId && r.push(`<!--FORMDOWN_GROUP_END_${this.currentGroupId}-->`);
		let l = o?.data;
		if (l) for (let e of t) Object.prototype.hasOwnProperty.call(l, e.name) && (e.value = l[e.name]);
		return {
			fields: t,
			cleanedMarkdown: this.placeInlineFields(r.join("\n"), t),
			frontMatter: o
		};
	}
	readFrontMatter(e, t) {
		let n = this.options.frontMatter;
		if (n) {
			let { data: r, diagnostics: i } = n(e, t);
			return this.diagnostics.push(...i), {
				data: r,
				raw: e,
				span: t
			};
		}
		return e.trim() !== "" && this.diagnostics.push({
			code: "front-matter-unread",
			message: "Front matter was found but its values were not read: give the parser a front matter reader (yamlFrontMatter from @formdown/core/front-matter)",
			severity: "warning",
			span: t
		}), {
			data: {},
			raw: e,
			span: t
		};
	}
	inlineMarker(e) {
		return this.markedInlineFields.push(e), `${tn}${this.markedInlineFields.length - 1}${nn}`;
	}
	placeInlineFields(e, t) {
		let n = this.markedInlineFields;
		return this.markedInlineFields = [], e.replace(rn, (e, r) => `<!--FORMDOWN_FIELD_${t.indexOf(n[Number(r)])}-->`);
	}
	parseBlockField(e) {
		let t = e.trim(), n = { input: t }, r = null;
		try {
			r = j().getFieldTypeRegistry().parseField(t, n);
		} catch (e) {
			let n = e instanceof Error ? e.message : String(e);
			this.diagnostics.push({
				code: "field-type-error",
				message: `A field type failed to parse "${t}": ${n}`,
				severity: "error"
			});
		}
		if (r) return r;
		let i = this.parseActionElement(t);
		if (i) return i;
		if (Jt.some((e) => e.test(t))) {
			let e = this.parseShorthandBlockField(t);
			if (e) return e;
		}
		let a = t.match(Yt);
		if (!a) return null;
		let [, o, s, c, l, u] = a, d = this.createField(o, s, u);
		return d && l && (d.relation = {
			target: l,
			type: c === "<->" ? "many-to-many" : "fk"
		}), d;
	}
	parseShorthandBlockField(e) {
		let t = e.match(Xt);
		if (!t && (t = e.match(Zt), t)) {
			let [, e, n, r, i, a, o, s, c, l] = t;
			t = [
				t[0],
				e,
				r,
				i,
				n,
				a,
				o,
				s,
				c,
				l
			];
		}
		if (!t) return null;
		let [, n, r, i, a, o, s, c, l, u] = t;
		if (!r && i === void 0 && !a && !c && !l && !s) return null;
		let d = this.convertShorthandToField(n, r, i, a, c || "", l, u);
		return d && s && (d.relation = {
			target: s,
			type: o === "<->" ? "many-to-many" : "fk"
		}), d;
	}
	parseInlineFields(e, t = 0) {
		let n = [], { masked: r, restore: i } = At(e), a = [], o = this.options.inlineFieldDelimiter;
		this.checkInlineFieldSyntax(r, o, t);
		let s = A(String.raw`(dt|d|[#@%&t?TrscRFCMW$]?)${o}@(${k})(\*)?(?:\{([^}]*)\})?(?:${dt})?(?:${vt}|:\s*([^\s]*?)${vt})?`, "g"), c = r.replace(s, (e, r, i, o, s, c, l, u, d, f) => {
			if (!r && !o && !s && !l && !u && !d) return e;
			if (!r && l) {
				let t = l.split(/\s/)[0];
				if (Qt.includes(t)) return e;
			}
			let p = r || u || "", m = l || d || "", h = this.convertShorthandToField(i, o, s, c, p, "", m);
			if (h) {
				h.inline = !0, h.span = this.spanAt(t + f, e.length), n.push(h);
				let r = this.inlineMarker(h);
				return a.push({
					at: f,
					delta: r.length - e.length
				}), r;
			}
			return e;
		}), l = A(String.raw`${o}@(${k})(?:\{([^}]*)\})?(?:${dt})?(?::\s*([^\s]*?)${vt}|${vt})?`, "g");
		return c = c.replace(l, (e, r, i, o, s, c, l, u) => {
			let d = "text";
			s && c !== void 0 ? d = c.trim() ? `${s} ${c}` : s : l !== void 0 && (d = l);
			let f = this.createField(r, o, d);
			if (f && i) {
				if ([
					"select",
					"radio",
					"checkbox"
				].includes(f.type)) {
					let e = et(i);
					e.options.length > 0 && (f.options = e.options), e.allowOther && (f.allowOther = !0, e.otherLabel && (f.otherLabel = e.otherLabel));
				} else {
					let e = this.declareDatalist(i);
					e && (f.attributes = f.attributes || {}, f.attributes.list = e);
				}
			}
			if (f) {
				f.inline = !0;
				let r = 0;
				for (let { at: e, delta: t } of a) {
					if (e + r >= u) break;
					r += t;
				}
				return f.span = this.spanAt(t + u - r, e.length), n.push(f), this.inlineMarker(f);
			}
			return e;
		}), n.sort((e, t) => e.span.start - t.span.start), {
			cleanedLine: i(c),
			inlineFields: n
		};
	}
	convertShorthandToField(e, t, n, r, i, a, o) {
		let s = {
			"@": "email",
			"#": "number",
			"%": "tel",
			"&": "url",
			d: "date",
			t: "time",
			dt: "datetime-local",
			"?": "password",
			T: "textarea",
			r: "radio",
			s: "select",
			c: "checkbox",
			R: "range",
			F: "file",
			C: "color",
			M: "month",
			W: "week",
			$: "number"
		}, c = i ? void 0 : yt(o ?? "").find((e) => e.value === void 0 && Qt.includes(e.key))?.key, l = s[i] || c || "text", u = o ? this.parseAttributes(o) : {};
		if (c && delete u[c], t === "*" && (u.required = !0), l === "textarea" && a && (u.rows = parseInt(a, 10)), i === "$" && (u.inputmode = "decimal", u.step = "0.01", u.placeholder || (u.placeholder = "0.00")), n) {
			let e = this.interpretContent(n, i || {
				select: "s",
				radio: "r",
				checkbox: "c"
			}[l] || "");
			u = {
				...u,
				...e
			};
		}
		let d = this.buildTypeAndAttributesString(l, u);
		return this.createField(e, r, d);
	}
	interpretContent(e, t) {
		if ([
			"r",
			"s",
			"c"
		].includes(t)) {
			let t = et(e), n = { options: nt(t.options) };
			return t.allowOther && (n["allow-other"] = !0, t.otherLabel && (n["other-label"] = t.otherLabel)), n;
		}
		if ([
			"d",
			"t",
			"dt"
		].includes(t)) return { format: e };
		let n = e.includes(","), r = e.match(/^\^.*\$$/) || e.includes("[") && e.includes("]") && !n || e.includes("\\"), i = e.includes("#") || !n && e.includes("*");
		if (r || i) {
			let t = e;
			return (e.includes("#") || e.includes("*") && !e.match(/^\^.*\$$/)) && (t = "^" + e.replace(/[().\/]/g, "\\$&").replace(/-/g, "\\-").replace(/#{1,}/g, (e) => `\\d{${e.length}}`).replace(/\*/g, ".*").replace(/\?/g, ".") + "$"), { pattern: t };
		}
		if (e && ![
			"r",
			"s",
			"c",
			"d",
			"t",
			"dt"
		].includes(t) && (n || !r && e.length > 0)) {
			let t = this.declareDatalist(e);
			if (t) return { list: t };
		}
		return { pattern: e };
	}
	parseAttributes(e) {
		let t = {};
		for (let n of yt(e)) t[n.key] = n.key === "required" || bt(n);
		return t;
	}
	buildTypeAndAttributesString(e, t) {
		let n = [e];
		for (let [e, r] of Object.entries(t)) r === !0 ? n.push(e) : typeof r == "string" ? n.push(`${e}=${xt(r)}`) : n.push(`${e}=${r}`);
		return n.join(" ");
	}
	createField(e, t, n) {
		if (/^\d/.test(e) || !e.trim()) return null;
		if (!n.trim()) return {
			name: e,
			type: "text",
			label: t || gt(e),
			attributes: {}
		};
		let r = yt(n);
		if (r.length === 0) return null;
		let i = "text", a = -1;
		for (let e = 0; e < r.length; e++) {
			let t = r[e], n = t.key, o = t.value !== void 0;
			if (t.value, !o) {
				let t = {
					s: "select",
					r: "radio",
					c: "checkbox",
					T: "textarea",
					"@": "email",
					"#": "number",
					"%": "tel",
					$: "number",
					"?": "password",
					t: "time",
					d: "date",
					dt: "datetime-local"
				}[n] || n;
				if (Qt.includes(t)) {
					i = t, a = e;
					break;
				}
			}
		}
		let o = {
			name: e,
			type: i,
			label: t || gt(e),
			attributes: {}
		};
		for (let e = 0; e < r.length; e++) {
			if (e === a) continue;
			let t = r[e], n = t.key, s = t.value !== void 0, c = t.value ?? "";
			if (n === "required") o.required = !0;
			else if (n === "label" && s) o.label = c;
			else if (n === "placeholder" && s) o.placeholder = c;
			else if (n === "description" && s) o.description = c;
			else if (n === "error-message" && s) o.errorMessage = c;
			else if (n === "compute" && s) o.compute = c;
			else if (n === "options" && s) {
				let e = c;
				if ([
					"radio",
					"checkbox",
					"select"
				].includes(i)) {
					if (e) {
						let t = et(e);
						o.options = t.options, t.allowOther && (o.allowOther = !0, t.otherLabel && (o.otherLabel = t.otherLabel));
					} else o.options = [];
				}
			} else if (n === "allow-other") o.allowOther = !0;
			else if (n === "other-label" && s) o.otherLabel = c;
			else if (n === "format" && s) o.format = c;
			else if (n === "pattern" && s) o.pattern = c;
			else if (n === "content" && s) o.content = c;
			else if (n === "value") o.value = s ? bt(t) : "";
			else if (n === "datalist" && s) {
				let e = c;
				if (e.startsWith("#")) o.attributes.list = e.slice(1);
				else {
					let t = e.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
					if (t.length > 0) {
						let n = this.generateDatalistId(e);
						o.attributes.list = n, this.datalistDeclarations.find((e) => e.id === n) || this.datalistDeclarations.push({
							id: n,
							options: t
						});
					}
				}
			} else if (n in mt && s) {
				let e = this.parseCondition(c);
				e ? o.conditions = {
					...o.conditions,
					[mt[n]]: e
				} : this.unreadableConditions.push({
					field: o,
					attribute: n,
					text: c
				});
			} else s ? o.attributes[n] = bt(t) : o.attributes[n] = !0;
		}
		return o;
	}
	spanAt(e, t) {
		let n = (this.lineStarts[this.currentLine] ?? 0) + e;
		return {
			start: n,
			end: n + t,
			line: this.currentLine + 1,
			column: e + 1
		};
	}
	reportLine(e, t, n, r = "warning") {
		let i = Math.max(0, n.search(/\S/));
		this.report(e, t, i, n.trim().length, r);
	}
	report(e, t, n, r, i = "error") {
		let a = (this.lineStarts[this.currentLine] ?? 0) + n;
		this.diagnostics.push({
			code: e,
			message: t,
			severity: i,
			span: {
				start: a,
				end: a + r,
				line: this.currentLine + 1,
				column: n + 1
			}
		});
	}
	checkAttributeBrackets(e, t, n, r = 0) {
		let i = St(e, t);
		return "error" in i && (this.report(i.error, i.error === "unterminated-quoted-value" ? "A quoted attribute value is never closed; attribute values cannot span lines" : "Field attributes are opened with \"[\" but never closed with \"]\"", r + n, e.length - n), !0);
	}
	checkBlockFieldSyntax(e) {
		let t = e.trim(), n = t.match($t);
		if (!n) {
			this.checkBracketlessField(e, t);
			return;
		}
		let r = e.indexOf(t);
		if (!_t(n[1])) {
			this.report("invalid-field-name", `"${n[1]}" is not a valid field name: names start with a letter or underscore`, r, n[0].length);
			return;
		}
		if (this.checkAttributeBrackets(e, r + n[0].length - 1, r)) return;
		let i = t.indexOf(":"), a = t.slice(i + 1), o = /^\s*\S*\{/.test(a) ? ` In shorthand, the braces go after the name: @${n[1]}{…}: r[]` : "";
		this.report("unrecognized-field", `This line looks like the field "${n[1]}" but is not read as one, so it shows as text.${o}`, r, t.length, "warning");
		let s = o ? this.bracesMoved(t, i) : void 0;
		Object.assign(this.diagnostics[this.diagnostics.length - 1], {
			field: n[1],
			...s && { fix: s }
		});
	}
	bracesMoved(e, t) {
		let n = e.slice(t + 1).match(/^(\s*\S*?)\{([^}]*)\}(.*)$/);
		if (!n) return;
		let [, r, i, a] = n, o = `${e.slice(0, t).trimEnd()}{${i}}:${r}${a}`;
		return o.match(Zt) ? o : void 0;
	}
	checkBracketlessField(e, t) {
		let n = t.match(en);
		if (!n || !_t(n[1])) return;
		let [, r, i, a] = n;
		if (a.trim() !== "" && !a.includes("=")) return;
		let o = `${t.slice(0, t.indexOf(":") + 1)} [${i}${a.trimEnd()}]`;
		this.report("unrecognized-field", `This line looks like the field "${r}" but is not read as one, so it shows as text. Its type and attributes go in brackets: ${o}`, e.indexOf(t), t.length, "warning"), Object.assign(this.diagnostics[this.diagnostics.length - 1], {
			field: r,
			fix: o
		});
	}
	checkInlineFieldSyntax(e, t, n = 0) {
		let r = A(String.raw`${t}@(\p{N}[\p{L}\p{N}_]*)`, "g");
		for (let t of e.matchAll(r)) this.report("invalid-field-name", `"${t[1]}" is not a valid field name: names start with a letter or underscore`, n + t.index, t[0].length);
		let i = A(String.raw`${t}@${k}(?:\{[^}]*\})?(?:${ft})?(?::\s*[^\s\[]*)?\[`, "g");
		for (let t of e.matchAll(i)) this.checkAttributeBrackets(e, t.index + t[0].length - 1, t.index, n);
	}
	reportDuplicateNames(e) {
		let t = /* @__PURE__ */ new Set();
		for (let n of e) t.has(n.name) && this.diagnostics.push({
			code: "duplicate-field-name",
			message: `Field name "${n.name}" is used more than once`,
			severity: "warning",
			field: n.name,
			...n.span && { span: n.span }
		}), t.add(n.name);
	}
	reportConditions(e) {
		for (let { field: e, attribute: t, text: n } of this.unreadableConditions) this.diagnostics.push({
			code: "invalid-condition",
			message: `${t}="${n}" cannot be read: a condition is "field", "!field", "field=value" or "field!=value"`,
			severity: "warning",
			field: e.name,
			...e.span && { span: e.span }
		});
		let t = new Set(e.map((e) => e.name));
		for (let n of e) {
			let e = /* @__PURE__ */ new Map();
			for (let [r, i] of Object.entries(mt)) {
				let a = n.conditions?.[i];
				a && !t.has(a.field) && e.set(a.field, [...e.get(a.field) ?? [], r]);
			}
			for (let [t, r] of e) this.diagnostics.push({
				code: "condition-unknown-field",
				message: `${r.join(" and ")} ${r.length > 1 ? "name" : "names"} "${t}", which is not a field of this form`,
				severity: "warning",
				field: n.name,
				related: t,
				...n.span && { span: n.span }
			});
		}
	}
	reportSwitches(e) {
		for (let t of e) t.attributes?.switch !== void 0 && (t.type !== "checkbox" || t.options?.length) && this.diagnostics.push({
			code: "switch-needs-single-checkbox",
			message: t.type === "checkbox" ? `"${t.name}" has options, so it is not one value to switch on or off: switch is ignored` : `switch belongs to a single checkbox (@${t.name}: c[switch]), not a ${t.type} field: it is ignored`,
			severity: "warning",
			field: t.name,
			...t.span && { span: t.span }
		});
	}
	reportComputations(e) {
		let t = new Set(e.map((e) => e.name));
		for (let n of e) {
			if (n.compute === void 0) continue;
			let e = Ht(n.compute), r = "error" in e ? [{
				code: "invalid-compute",
				message: `compute="${n.compute}" ${e.error}: it is numbers and fields with + - * / and parentheses`
			}] : e.fields.filter((e) => !t.has(e) || e === n.name).map((e) => ({
				code: "compute-unknown-field",
				message: e === n.name ? `compute reads "${e}", the field it computes` : `compute reads "${e}", which is not a field of this form`,
				related: e
			}));
			for (let e of r) this.diagnostics.push({
				...e,
				severity: "warning",
				field: n.name,
				...n.span && { span: n.span }
			});
		}
	}
	parseCondition(e) {
		if (!e || !e.trim()) return null;
		let t = e.trim(), n = t.match(A(String.raw`^(${k})=(.+)$`));
		if (n) return {
			field: n[1],
			operator: "=",
			value: n[2]
		};
		let r = t.match(A(String.raw`^(${k})!=(.+)$`));
		if (r) return {
			field: r[1],
			operator: "!=",
			value: r[2]
		};
		if (t.startsWith("!")) {
			let e = t.slice(1).trim();
			if (e && _t(e)) return {
				field: e,
				operator: "falsy"
			};
		}
		return _t(t) ? {
			field: t,
			operator: "truthy"
		} : null;
	}
	parseActionElement(e) {
		let t = e.match(/^@\[(\w+)\s+"([^"]+)"([^\]]*)\]$/);
		if (!t) return null;
		let [, n, r, i] = t;
		if (![
			"submit",
			"reset",
			"button",
			"image"
		].includes(n)) return null;
		let a = {};
		if (i.trim()) {
			let e = this.parseAttributes(i.trim());
			Object.assign(a, e);
		}
		let o;
		if (typeof a.name == "string" && _t(a.name)) o = a.name;
		else {
			let e = (this.actionCounts.get(n) ?? 0) + 1;
			this.actionCounts.set(n, e), o = `${n}_${e}`;
		}
		let s = {
			name: o,
			type: n === "image" ? "image" : "button",
			label: r,
			attributes: {
				type: n,
				...a
			}
		};
		return n === "image" && !a.src && this.report("image-without-src", `The image button "${r}" has no src, so it shows no image`, 0, e.length, "warning"), s;
	}
	parseFormDeclaration(e) {
		let t = e.trim().match(/^@form\[([^\]]*)\]\s*$/);
		if (!t) return null;
		let n = t[1], r = this.parseAttributes(n), i = r.id || this.generateFormId();
		return r.id && delete r.id, {
			id: i,
			attributes: r
		};
	}
	generateFormId() {
		return `formdown-form-${this.formCounter++}`;
	}
	declareDatalist(e) {
		let t = e.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
		if (t.length === 0) return;
		let n = this.generateDatalistId(e);
		return this.datalistDeclarations.some((e) => e.id === n) || this.datalistDeclarations.push({
			id: n,
			options: t
		}), n;
	}
	generateDatalistId(e) {
		let t = e.toLowerCase().replace(/\s+/g, "").replace(/,/g, "-").split("").reduce((e, t) => (e = (e << 5) - e + t.charCodeAt(0), e & e), 0);
		return `datalist-${Math.abs(t)}`;
	}
	parseShorthandDatalist(e) {
		let t = e.trim().match(/^@#([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.+)$/);
		if (!t) return null;
		let n = t[1], r = t[2].split(",").map((e) => e.trim()).filter((e) => e.length > 0);
		return r.length === 0 ? (this.reportLine("datalist-without-options", `Datalist "${n}" lists no options`, e), null) : {
			id: n,
			options: r
		};
	}
	parseDatalistDeclaration(e) {
		let t = e.trim().match(/^@datalist\[([^\]]*)\]\s*$/);
		if (!t) return null;
		let n = t[1], r = this.parseAttributes(n);
		if (!r.id) return this.reportLine("datalist-without-id", "A datalist declaration needs an id (@datalist[id=\"…\" options=\"…\"])", e), null;
		if (r.options === void 0) return this.reportLine("datalist-without-options", `Datalist "${r.id}" has no options attribute`, e), null;
		let i = typeof r.options == "string" ? r.options.split(",").map((e) => e.trim()).filter((e) => e.length > 0) : [];
		return i.length === 0 ? (this.reportLine("datalist-without-options", `Datalist "${r.id}" lists no options`, e), null) : {
			id: r.id,
			options: i
		};
	}
	parseGroupDeclaration(e, t) {
		let n = e.trim().match(/^##\s*\[([^\]]+)\]\s*$/);
		if (!n) return null;
		let r = n[1].trim(), i = r, a = !1, o = !1;
		return r.endsWith(" collapsed") ? (i = r.slice(0, -10).trim(), a = !0, o = !0) : r.endsWith(" collapsible") && (i = r.slice(0, -12).trim(), a = !0), {
			id: "formdown-group-" + i.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "-").replace(/^-+|-+$/g, ""),
			label: i,
			position: t,
			collapsible: a || void 0,
			collapsed: o || void 0
		};
	}
	getDefaultFormId() {
		return this.defaultFormCreated || (this.defaultFormCreated = !0, this.formDeclarations.push({
			id: "formdown-form-default",
			attributes: {
				action: ".",
				method: "GET"
			}
		})), "formdown-form-default";
	}
	associateFieldWithForm(e) {
		e.attributes?.form ? this.formDeclarations.some((t) => t.id === e.attributes.form) || (this.diagnostics.push({
			code: "form-unknown",
			message: `"${e.name}" names form "${String(e.attributes.form)}", which is not declared before it: it belongs to the current form instead`,
			severity: "warning",
			field: e.name,
			...e.span && { span: e.span }
		}), e.attributes.form = this.currentFormId || this.getDefaultFormId()) : this.currentFormId ? (e.attributes ||= {}, e.attributes.form = this.currentFormId) : (e.attributes ||= {}, e.attributes.form = this.getDefaultFormId()), this.currentGroupId && (e.group = this.currentGroupId);
	}
	parseTableBlock(e, t) {
		let n = [], r = t;
		for (; r < e.length && e[r].trim().startsWith("|");) n.push(e[r]), r++;
		if (n.length < 3) return null;
		let i = n[0], a = n[1];
		if (!/^\|[\s\-|:]+\|$/.test(a.trim())) return null;
		let o = [], s = this.parseTableRow(i), c = [], l = this.currentLine;
		for (let e = 2; e < n.length; e++) {
			this.currentLine = t + e;
			let r = this.parseTableRow(n[e]), i = this.tableCellColumns(n[e]), a = [];
			r.forEach((e, t) => {
				let { cleanedLine: n, inlineFields: r } = this.parseInlineFields(e, i[t] ?? 0);
				o.push(...r), a.push(n);
			}), c.push(a);
		}
		return this.currentLine = l, {
			fields: o,
			tableHtml: this.generateTableHtml(s, c),
			endIndex: r - 1
		};
	}
	tableCellColumns(e) {
		let t = [], n = [];
		for (let t = 0; t < e.length; t++) e[t] === "|" && n.push(t);
		for (let r = 0; r + 1 < n.length; r++) {
			let i = e.slice(n[r] + 1, n[r + 1]);
			t.push(n[r] + 1 + (i.length - i.trimStart().length));
		}
		let r = e.slice(n[n.length - 1] + 1);
		return n.length > 0 && r.trim() && t.push(n[n.length - 1] + 1 + (r.length - r.trimStart().length)), t;
	}
	parseTableRow(e) {
		return e.trim().replace(/^\||\|$/g, "").split("|").map((e) => e.trim());
	}
	generateTableHtml(e, t) {
		return `<table class="formdown-table">
<thead>
<tr>${e.map((e) => `<th>${M(e)}</th>`).join("")}</tr>
</thead>
<tbody>
${t.map((e) => `<tr>${e.map((e) => `<td>${e}</td>`).join("")}</tr>`).join("\n")}
</tbody>
</table>`;
	}
};
// node_modules/@formdown/core/dist/switch.js
function on(e) {
	let t = e.attributes?.switch;
	return e.type === "checkbox" && !e.options?.length && (t === !0 || t === "true");
}
// node_modules/marked/lib/marked.esm.js
function sn() {
	return {
		async: !1,
		breaks: !1,
		extensions: null,
		gfm: !0,
		hooks: null,
		pedantic: !1,
		renderer: null,
		silent: !1,
		tokenizer: null,
		walkTokens: null
	};
}
var cn = sn();
function ln(e) {
	cn = e;
}
var un = { exec: () => null };
function dn(e) {
	let t = [];
	return (n) => {
		let r = Math.max(0, Math.min(3, n - 1)), i = t[r];
		return i || (i = e(r), t[r] = i), i;
	};
}
function N(e, t = "") {
	let n = typeof e == "string" ? e : e.source, r = {
		replace: (e, t) => {
			let i = typeof t == "string" ? t : t.source;
			return i = i.replace(P.caret, "$1"), n = n.replace(e, i), r;
		},
		getRegex: () => new RegExp(n, t)
	};
	return r;
}
var fn = ((e = "") => {
	try {
		return !!RegExp("(?<=1)(?<!1)" + e);
	} catch {
		return !1;
	}
})(), P = {
	codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
	outputLinkReplace: /\\([\[\]])/g,
	indentCodeCompensation: /^(\s+)(?:```)/,
	beginningSpace: /^\s+/,
	endingHash: /#$/,
	startingSpaceChar: /^ /,
	endingSpaceChar: / $/,
	endingSpaceTabChar: /[ \t]$/,
	nonSpaceChar: /[^ ]/,
	newLineCharGlobal: /\n/g,
	tabCharGlobal: /\t/g,
	leadingSpaceTab: /^[ \t]+/,
	multipleSpaceGlobal: /\s+/g,
	blankLine: /^[ \t]*$/,
	doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
	blockquoteStart: /^ {0,3}>/,
	blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
	blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
	listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
	listIsTask: /^\[[ xX]\] +\S/,
	listReplaceTask: /^\[[ xX]\] +/,
	listTaskCheckbox: /\[[ xX]\]/,
	anyLine: /\n.*\n/,
	hrefBrackets: /^<(.*)>$/,
	tableDelimiter: /[:|]/,
	tableAlignChars: /^\||\| *$/g,
	tableRowBlankLine: /\n[ \t]*$/,
	tableAlignRight: /^ *-+: *$/,
	tableAlignCenter: /^ *:-+: *$/,
	tableAlignLeft: /^ *:-+ *$/,
	startATag: /^<a /i,
	endATag: /^<\/a>/i,
	startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
	endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
	startAngleBracket: /^</,
	endAngleBracket: />$/,
	pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
	unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
	numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,
	numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
	escapeTest: /[&<>"']/,
	escapeReplace: /[&<>"']/g,
	escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
	escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
	caret: /(^|[^\[])\^/g,
	percentDecode: /%25/g,
	findPipe: /\|/g,
	splitPipe: / \|/,
	slashPipe: /\\\|/g,
	carriageReturn: /\r\n|\r/g,
	spaceLine: /^ +$/gm,
	notSpaceStart: /^\S*/,
	endingNewline: /\n$/,
	listItemRegex: (e) => RegExp(`^( {0,3}${e})((?:[	 ][^\\n]*)?(?:\\n|$))`),
	nextBulletRegex: dn((e) => RegExp(`^ {0,${e}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)),
	hrRegex: dn((e) => RegExp(`^ {0,${e}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)),
	fencesBeginRegex: dn((e) => RegExp(`^ {0,${e}}(?:\`\`\`|~~~)`)),
	headingBeginRegex: dn((e) => RegExp(`^ {0,${e}}#`)),
	htmlBeginRegex: dn((e) => RegExp(`^ {0,${e}}(?:</?(?:${Dn})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, "i")),
	blockquoteBeginRegex: dn((e) => RegExp(`^ {0,${e}}>`))
}, pn = /^(?:[ \t]*(?:\n|$))+/, mn = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/, hn = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/, gn = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/, _n = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/, vn = / {0,3}(?:[*+-]|\d{1,9}[.)])/, yn = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/, bn = N(yn).replace(/bull/g, vn).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex(), xn = N(yn).replace(/bull/g, vn).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(), Sn = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/, Cn = /^[^\n]+/, wn = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/, Tn = N(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", wn).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(), En = N(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, vn).getRegex(), Dn = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul", On = /<!--(?:-?>|[\s\S]*?(?:-->|$))/, kn = N("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", On).replace("tag", Dn).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(), An = (e) => N(Sn).replace("hr", gn).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", e).replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Dn).getRegex(), jn = An(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/), Mn = An(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/), Nn = {
	blockquote: N(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", Mn).getRegex(),
	code: mn,
	def: Tn,
	fences: hn,
	heading: _n,
	hr: gn,
	html: kn,
	lheading: bn,
	list: En,
	newline: pn,
	paragraph: jn,
	table: un,
	text: Cn
}, Pn = N("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", gn).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Dn).getRegex(), Fn = {
	...Nn,
	lheading: xn,
	table: Pn,
	paragraph: N(Sn).replace("hr", gn).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", Pn).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Dn).getRegex()
}, In = {
	...Nn,
	html: N("^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:\"[^\"]*\"|'[^']*'|\\s[^'\"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))").replace("comment", On).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
	def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
	heading: /^(#{1,6})(.*)(?:\n+|$)/,
	fences: un,
	lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
	paragraph: N(Sn).replace("hr", gn).replace("heading", " *#{1,6} *[^\n]").replace("lheading", bn).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex()
}, Ln = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/, Rn = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/, zn = /^( {2,}|\\)\n(?!\s*$)[ \t]*/, Bn = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/, F = /[\p{P}\p{S}]/u, Vn = /[\s\p{P}\p{S}]/u, Hn = /[^\s\p{P}\p{S}]/u, Un = N(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, Vn).getRegex(), Wn = /[\p{Pi}\p{Ps}"']/u, Gn = /(?!~)[\p{P}\p{S}]/u, Kn = /(?!~)[\s\p{P}\p{S}]/u, qn = /(?:[^\s\p{P}\p{S}]|~)/u, Jn = N(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", fn ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex(), Yn = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/, Xn = N(Yn, "u").replace(/punct/g, F).getRegex(), Zn = N(Yn, "u").replace(/punct/g, Gn).getRegex(), Qn = N(/^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/, "u").replace(/openQuote/g, Wn).replace(/punct/g, F).getRegex(), $n = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)", er = N($n, "gu").replace(/notPunctSpace/g, Hn).replace(/punctSpace/g, Vn).replace(/punct/g, F).getRegex(), tr = N($n, "gu").replace(/notPunctSpace/g, qn).replace(/punctSpace/g, Kn).replace(/punct/g, Gn).getRegex(), nr = N("^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, Hn).replace(/punctSpace/g, Vn).replace(/punct/g, F).getRegex(), rr = N("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, Hn).replace(/punctSpace/g, Vn).replace(/punct/g, F).getRegex(), ir = N("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, Hn).replace(/punctSpace/g, Vn).replace(/punct/g, F).getRegex(), ar = N(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, F).getRegex(), or = N("^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, Hn).replace(/punctSpace/g, Vn).replace(/punct/g, F).getRegex(), sr = N(/\\(punct)/, "gu").replace(/punct/g, F).getRegex(), cr = N(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, "gu").replace(/punct/g, F).getRegex(), lr = N(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(), ur = N(On).replace("(?:-->|$)", "-->").getRegex(), dr = N("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", ur).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(), fr = /\[(?:\\[\s\S]|[^\[\]\\])*\]/, pr = N(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", fr).getRegex(), mr = N(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace("label", pr).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(), hr = N(/^!?\[(label)\]\[(ref)\]/).replace("label", pr).replace("ref", wn).getRegex(), gr = N(/^!?\[(ref)\](?:\[\])?/).replace("ref", wn).getRegex(), _r = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/, vr = N(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", fr).getRegex(), yr = N("reflink|nolink(?!\\()", "g").replace("reflink", N(/^!?\[(label)\]\[(ref)\]/).replace("label", vr).replace("ref", _r).getRegex()).replace("nolink", N(/^!?\[(ref)\](?:\[\])?/).replace("ref", _r).getRegex()).getRegex(), br = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/, xr = N(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(), Sr = {
	_backpedal: un,
	anyPunctuation: sr,
	anyPunctuationOutsideCode: cr,
	autolink: lr,
	blockSkip: Jn,
	br: zn,
	code: Rn,
	del: un,
	delLDelim: un,
	delRDelim: un,
	emStrongLDelim: Xn,
	emStrongRDelimAst: er,
	emStrongRDelimUnd: rr,
	escape: Ln,
	link: mr,
	nolink: gr,
	punctuation: Un,
	reflink: hr,
	reflinkSearch: yr,
	tag: dr,
	text: Bn,
	url: un
}, Cr = {
	...Sr,
	emStrongLDelim: Qn,
	emStrongRDelimAst: nr,
	emStrongRDelimUnd: ir,
	link: N(/^!?\[(label)\]\((.*?)\)/).replace("label", pr).getRegex(),
	reflink: N(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", pr).getRegex()
}, wr = {
	...Sr,
	emStrongRDelimAst: tr,
	emStrongLDelim: Zn,
	delLDelim: ar,
	delRDelim: or,
	url: N(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", xr).replace("protocol", br).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(),
	_backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
	del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,
	text: N(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", br).replace(/emailProtocol/g, /(?:mailto|xmpp):/).getRegex()
}, Tr = {
	...wr,
	br: N(zn).replace("{2,}", "*").getRegex(),
	text: N(wr.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
}, Er = {
	normal: Nn,
	gfm: Fn,
	pedantic: In
}, Dr = {
	normal: Sr,
	gfm: wr,
	breaks: Tr,
	pedantic: Cr
}, Or = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
}, kr = (e) => Or[e];
function I(e, t) {
	if (t) {
		if (P.escapeTest.test(e)) return e.replace(P.escapeReplace, kr);
	} else if (P.escapeTestNoEncode.test(e)) return e.replace(P.escapeReplaceNoEncode, kr);
	return e;
}
function Ar(e) {
	return P.numericCharacterReference.test(e) ? e.replace(P.numericCharacterReferenceOrAmpersand, (e, t, n) => {
		if (t === void 0 && n === void 0) return "&amp;";
		let r = t === void 0 ? Number.parseInt(n, 16) : Number.parseInt(t, 10);
		return r === 0 || r > 1114111 || r >= 55296 && r <= 57343 ? "�" : r === 38 ? "&amp;" : String.fromCodePoint(r);
	}) : e;
}
function jr(e) {
	try {
		e = encodeURI(e).replace(P.percentDecode, "%");
	} catch {
		return null;
	}
	return e;
}
function Mr(e, t) {
	let n = e.replace(P.findPipe, (e, t, n) => {
		let r = !1, i = t;
		for (; --i >= 0 && n[i] === "\\";) r = !r;
		return r ? "|" : " |";
	}).split(P.splitPipe), r = 0;
	if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), t) {
		if (n.length > t) n.splice(t);
		else for (; n.length < t;) n.push("");
	}
	for (; r < n.length; r++) n[r] = n[r].trim().replace(P.slashPipe, "|");
	return n;
}
function Nr(e, t, n) {
	let r = e.length;
	if (r === 0) return "";
	let i = 0;
	for (; i < r;) {
		let a = e.charAt(r - i - 1);
		if (a === t && !n) i++;
		else if (a !== t && n) i++;
		else break;
	}
	return e.slice(0, r - i);
}
function Pr(e) {
	let t = e.split("\n"), n = t.length - 1;
	for (; n >= 0 && P.blankLine.test(t[n]);) n--;
	return t.length - n <= 2 ? e : t.slice(0, n + 1).join("\n");
}
function Fr(e) {
	return e.trim().toLowerCase().toUpperCase().toLowerCase();
}
function Ir(e, t) {
	if (e.indexOf(t[0]) === -1 && e.indexOf(t[1]) === -1) return -1;
	let n = 0;
	for (let r = 0; r < e.length; r++) if (e[r] === "\\") r++;
	else if (e[r] === t[0]) n++;
	else if (e[r] === t[1] && (n--, n < 0)) return r;
	return n > 0 ? -2 : -1;
}
function Lr(e, t = 0) {
	let n = t, r = "";
	for (let t of e) if (t === "	") {
		let e = 4 - n % 4;
		r += " ".repeat(e), n += e;
	} else r += t, n++;
	return r;
}
function Rr(e, t, n, r, i) {
	let a = t.href, o = t.title || null, s = e[1].replace(i.other.outputLinkReplace, "$1"), c = e[0].charAt(0) === "!", l = r.state.inLink, u = r.state.linkEmitted, d = r.state.inRawBlock;
	r.state.inLink = !0, r.state.linkEmitted = !1;
	let f = r.inlineTokens(s), p = r.state.linkEmitted;
	if (r.state.linkEmitted = u, r.state.inLink = l, !c) {
		if (p) {
			r.state.inRawBlock = d;
			return;
		}
		r.state.linkEmitted = !0;
	}
	return {
		type: c ? "image" : "link",
		raw: n,
		href: a,
		title: o,
		text: s,
		tokens: f
	};
}
function zr(e, t, n) {
	let r = e.match(n.other.indentCodeCompensation);
	if (r === null) return t;
	let i = r[1];
	return t.split("\n").map((e) => {
		let t = e.match(n.other.beginningSpace);
		if (t === null) return e;
		let [r] = t;
		return e.slice(Math.min(r.length, i.length));
	}).join("\n");
}
function Br(e, t, n, r) {
	if (!t.includes("<")) return !1;
	for (let i = 0; i < t.length; i++) {
		if (t[i] === "\\") {
			i++;
			continue;
		}
		if (t[i] === "`") {
			let e = r.inline.code.exec(t.slice(i));
			if (e) {
				i += e[0].length - 1;
				continue;
			}
		}
		if (t[i] !== "<") continue;
		let a = e.slice(n + i), o = r.inline.tag.exec(a) || r.inline.autolink.exec(a);
		if (o) {
			if (o[0].length > t.length - i) return !0;
			i += o[0].length - 1;
		}
	}
	return !1;
}
var Vr = class {
	options;
	rules;
	lexer;
	constructor(e) {
		this.options = e || cn;
	}
	space(e) {
		let t = this.rules.block.newline.exec(e);
		if (t && t[0].length > 0) return {
			type: "space",
			raw: t[0]
		};
	}
	code(e) {
		let t = this.rules.block.code.exec(e);
		if (t) {
			let e = this.options.pedantic ? t[0] : Pr(t[0]);
			return {
				type: "code",
				raw: e,
				codeBlockStyle: "indented",
				text: e.replace(this.rules.other.codeRemoveIndent, "")
			};
		}
	}
	fences(e) {
		let t = this.rules.block.fences.exec(e);
		if (t) {
			let e = t[0], n = zr(e, t[3] || "", this.rules);
			return {
				type: "code",
				raw: e,
				lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2],
				text: n
			};
		}
	}
	heading(e) {
		let t = this.rules.block.heading.exec(e);
		if (t) {
			let e = t[2].trim();
			if (this.rules.other.endingHash.test(e)) {
				let t = Nr(e, "#");
				(this.options.pedantic || !t || this.rules.other.endingSpaceTabChar.test(t)) && (e = t.trim());
			}
			return {
				type: "heading",
				raw: Nr(t[0], "\n"),
				depth: t[1].length,
				text: e,
				tokens: this.lexer.inline(e)
			};
		}
	}
	hr(e) {
		let t = this.rules.block.hr.exec(e);
		if (t) return {
			type: "hr",
			raw: Nr(t[0], "\n")
		};
	}
	blockquote(e) {
		let t = this.rules.block.blockquote.exec(e);
		if (t) {
			let e = Nr(t[0], "\n").split("\n"), n = "", r = "", i = [];
			for (; e.length > 0;) {
				let t = !1, a = [], o = 0;
				for (; o < e.length; o++) if (this.rules.other.blockquoteStart.test(e[o])) a.push(e[o]), t = !0;
				else if (!t) a.push(e[o]);
				else break;
				e = e.slice(o);
				let s = a.join("\n"), c = s.replace(this.rules.other.blockquoteSetextReplace, "\n    $1").replace(this.rules.other.blockquoteSetextReplace2, "");
				n = n ? `${n}
${s}` : s, r = r ? `${r}
${c}` : c;
				let l = this.lexer.state.top;
				if (this.lexer.state.top = !0, this.lexer.blockTokens(c, i, !0), this.lexer.state.top = l, e.length === 0) break;
				let u = i.at(-1);
				if (u?.type === "code" || u?.type === "heading" || u?.type === "hr" || u?.type === "html") break;
				if (u?.type === "blockquote") {
					let t = u, a = e.join("\n"), o = t.raw + "\n" + a.replace(this.rules.other.blockquoteSetextReplace2, ""), s = this.blockquote(o);
					i[i.length - 1] = s;
					let c = o.substring(s.raw.length).replace(/^\n/, ""), l = c ? c.split("\n").length : 0, d = l ? e.slice(0, -l) : e;
					d.length > 0 && (n = `${n}
${d.join("\n")}`), r = r.substring(0, r.length - t.text.length) + s.text;
					break;
				}
				if (u?.type === "list") {
					let t = u, a = t.raw + "\n" + e.join("\n"), o = this.list(a);
					i[i.length - 1] = o, n = n.substring(0, n.length - u.raw.length) + o.raw, r = r.substring(0, r.length - t.raw.length) + o.raw, e = a.substring(i.at(-1).raw.length).split("\n");
				}
			}
			return {
				type: "blockquote",
				raw: n,
				tokens: i,
				text: r
			};
		}
	}
	list(e) {
		let t = this.rules.block.list.exec(e);
		if (t) {
			let n = e, r = () => n.length - e.length, i = t[1].trim(), a = i.length > 1, o = {
				type: "list",
				raw: "",
				ordered: a,
				start: a ? +i.slice(0, -1) : "",
				loose: !1,
				items: []
			};
			i = a ? `\\d{1,9}\\${i.slice(-1)}` : `\\${i}`, this.options.pedantic && (i = a ? i : "[*+-]");
			let s = this.rules.other.listItemRegex(i), c = !1;
			for (; e;) {
				let i = !1, a = "";
				if (!(t = s.exec(e)) || this.rules.block.hr.test(e)) break;
				let l = r();
				e = e.substring(t[0].length);
				let u = t[2].split("\n", 1)[0], d = t[1].length, f = this.options.pedantic ? Lr(u, d) : u.replace(this.rules.other.leadingSpaceTab, (e) => Lr(e, d)), p = e.split("\n", 1)[0], m = !f.trim(), h = 0;
				if (this.options.pedantic ? (h = 2, a = f.trimStart()) : m ? h = d + 1 : (h = f.search(this.rules.other.nonSpaceChar), h = h > 4 ? 1 : h, a = f.slice(h), h += d), m && this.rules.other.blankLine.test(p) && (e = e.substring(p.length + 1), i = !0), !i) {
					let t = this.rules.other.nextBulletRegex(h), n = this.rules.other.hrRegex(h), r = this.rules.other.fencesBeginRegex(h), i = this.rules.other.headingBeginRegex(h), o = this.rules.other.htmlBeginRegex(h), s = this.rules.other.blockquoteBeginRegex(h);
					for (; e;) {
						let c = e.split("\n", 1)[0], l;
						if (p = c, this.options.pedantic ? (p = p.replace(this.rules.other.listReplaceNesting, "  "), l = p) : l = p.replace(this.rules.other.leadingSpaceTab, (e) => Lr(e)), r.test(p) || i.test(p) || o.test(p) || s.test(p) || t.test(p) || n.test(p)) break;
						if (l.search(this.rules.other.nonSpaceChar) >= h || !p.trim()) a += "\n" + l.slice(h);
						else {
							if (m || f.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || r.test(f) || i.test(f) || n.test(f)) break;
							a += "\n" + p;
						}
						m = !p.trim(), e = e.substring(c.length + 1), f = l.slice(h);
					}
				}
				let g = n.slice(l, r());
				o.loose || (c ? o.loose = !0 : this.rules.other.doubleBlankLine.test(g) && (c = !0)), o.items.push({
					type: "list_item",
					raw: g,
					task: !!this.options.gfm && this.rules.other.listIsTask.test(a),
					loose: !1,
					text: a,
					tokens: []
				});
			}
			let l = o.items.at(-1);
			if (l) l.raw = l.raw.trimEnd(), l.text = l.text.trimEnd();
			else return;
			o.raw = n.slice(0, r()).trimEnd();
			for (let e of o.items) if (this.lexer.state.top = !1, e.tokens = this.lexer.blockTokens(e.text, []), !o.loose) {
				let t = e.tokens.filter((e) => e.type === "space");
				o.loose = t.length > 0 && t.some((e) => this.rules.other.anyLine.test(e.raw));
			}
			for (let e of o.items) {
				let t = e.tokens[0];
				if (e.task && (t?.type === "text" || t?.type === "paragraph")) {
					e.text = e.text.replace(this.rules.other.listReplaceTask, ""), t.raw = t.raw.replace(this.rules.other.listReplaceTask, ""), t.text = t.text.replace(this.rules.other.listReplaceTask, "");
					for (let e = this.lexer.inlineQueue.length - 1; e >= 0; e--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[e].src)) {
						this.lexer.inlineQueue[e].src = this.lexer.inlineQueue[e].src.replace(this.rules.other.listReplaceTask, "");
						break;
					}
					let n = this.rules.other.listTaskCheckbox.exec(e.raw);
					if (n) {
						let t = {
							type: "checkbox",
							raw: n[0] + " ",
							checked: n[0] !== "[ ]"
						};
						e.checked = t.checked, o.loose ? e.tokens[0] && ["paragraph", "text"].includes(e.tokens[0].type) && "tokens" in e.tokens[0] && e.tokens[0].tokens ? (e.tokens[0].raw = t.raw + e.tokens[0].raw, e.tokens[0].text = t.raw + e.tokens[0].text, e.tokens[0].tokens.unshift(t)) : e.tokens.unshift({
							type: "paragraph",
							raw: t.raw,
							text: t.raw,
							tokens: [t]
						}) : e.tokens.unshift(t);
					}
				} else e.task &&= !1;
			}
			if (o.loose) for (let e of o.items) {
				e.loose = !0;
				for (let t of e.tokens) t.type === "text" && (t.type = "paragraph");
			}
			return o;
		}
	}
	html(e) {
		let t = this.rules.block.html.exec(e);
		if (t) {
			let e = Pr(t[0]);
			return {
				type: "html",
				block: !0,
				raw: e,
				pre: t[1] === "pre" || t[1] === "script" || t[1] === "style",
				text: e
			};
		}
	}
	def(e) {
		let t = this.rules.block.def.exec(e);
		if (t) {
			if (!this.rules.other.startAngleBracket.test(t[2]) && Ir(t[2], "()") !== -1) return;
			let e = Fr(t[1]).replace(this.rules.other.multipleSpaceGlobal, " "), n = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
			return {
				type: "def",
				tag: e,
				raw: Nr(t[0], "\n"),
				href: n,
				title: r
			};
		}
	}
	table(e) {
		let t = this.rules.block.table.exec(e);
		if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
		let n = Mr(t[1]), r = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), i = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split("\n") : [], a = {
			type: "table",
			raw: Nr(t[0], "\n"),
			header: [],
			align: [],
			rows: []
		};
		if (n.length === r.length) {
			for (let e of r) this.rules.other.tableAlignRight.test(e) ? a.align.push("right") : this.rules.other.tableAlignCenter.test(e) ? a.align.push("center") : this.rules.other.tableAlignLeft.test(e) ? a.align.push("left") : a.align.push(null);
			for (let e = 0; e < n.length; e++) a.header.push({
				text: n[e],
				tokens: this.lexer.inline(n[e]),
				header: !0,
				align: a.align[e]
			});
			for (let e of i) a.rows.push(Mr(e, a.header.length).map((e, t) => ({
				text: e,
				tokens: this.lexer.inline(e),
				header: !1,
				align: a.align[t]
			})));
			return a;
		}
	}
	lheading(e) {
		let t = this.rules.block.lheading.exec(e);
		if (t) {
			let e = t[1].trim();
			return {
				type: "heading",
				raw: Nr(t[0], "\n"),
				depth: t[2].charAt(0) === "=" ? 1 : 2,
				text: e,
				tokens: this.lexer.inline(e)
			};
		}
	}
	paragraph(e) {
		let t = this.rules.block.paragraph.exec(e);
		if (t) {
			let e = t[1].charAt(t[1].length - 1) === "\n" ? t[1].slice(0, -1) : t[1];
			return {
				type: "paragraph",
				raw: t[0],
				text: e,
				tokens: this.lexer.inline(e)
			};
		}
	}
	text(e) {
		let t = this.rules.block.text.exec(e);
		if (t) return {
			type: "text",
			raw: t[0],
			text: t[0],
			tokens: this.lexer.inline(t[0])
		};
	}
	escape(e) {
		let t = this.rules.inline.escape.exec(e);
		if (t) return {
			type: "escape",
			raw: t[0],
			text: t[1]
		};
	}
	tag(e) {
		let t = this.rules.inline.tag.exec(e);
		if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = !0 : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = !1), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = !0 : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = !1), {
			type: "html",
			raw: t[0],
			inLink: this.lexer.state.inLink,
			inRawBlock: this.lexer.state.inRawBlock,
			block: !1,
			text: t[0]
		};
	}
	link(e) {
		if (this.lexer.state.linkParenPossible === !1) return;
		let t = this.rules.inline.link.exec(e);
		if (t) {
			let n = t[0].charAt(0) === "!" ? 2 : 1;
			if (!this.options.pedantic && Br(e, t[1], n, this.rules)) return;
			let r = t[2].trim();
			if (!this.options.pedantic && this.rules.other.startAngleBracket.test(r)) {
				if (!this.rules.other.endAngleBracket.test(r)) return;
				let e = Nr(r.slice(0, -1), "\\");
				if ((r.length - e.length) % 2 == 0) return;
			} else {
				let e = Ir(t[2], "()");
				if (e === -2) return;
				if (e > -1) {
					let n = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + e;
					t[2] = t[2].substring(0, e), t[0] = t[0].substring(0, n).trim(), t[3] = "";
				}
			}
			let i = t[2], a = "";
			if (this.options.pedantic) {
				let e = this.rules.other.pedanticHrefTitle.exec(i);
				e && (i = e[1], a = e[3]);
			} else a = t[3] ? t[3].slice(1, -1) : "";
			return i = i.trim(), this.rules.other.startAngleBracket.test(i) && (i = this.options.pedantic && !this.rules.other.endAngleBracket.test(r) ? i.slice(1) : i.slice(1, -1)), Rr(t, {
				href: i && i.replace(this.rules.inline.anyPunctuation, "$1"),
				title: a && a.replace(this.rules.inline.anyPunctuation, "$1")
			}, t[0], this.lexer, this.rules);
		}
	}
	reflink(e, t) {
		let n;
		if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
			let r = n[0].charAt(0) === "!" ? 2 : 1;
			if (!this.options.pedantic && Br(e, n[1], r, this.rules)) return;
			let i = t[Fr((n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "))];
			if (!i) {
				let e = n[0].charAt(0);
				return {
					type: "text",
					raw: e,
					text: e
				};
			}
			return Rr(n, i, n[0], this.lexer, this.rules);
		}
	}
	emStrong(e, t, n = "") {
		let r = this.rules.inline.emStrongLDelim.exec(e);
		if (!(!r || !r[1] && !r[2] && !r[3] && !r[4] || r[4] && n.match(this.rules.other.unicodeAlphaNumeric)) && (!(r[1] || r[3]) || !n || this.rules.inline.punctuation.exec(n))) {
			let i = [...r[0]].length - 1, a, o, s = i, c = 0, l = r[0][0], u = n === l, d = l === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
			for (d.lastIndex = 0, t = t.slice(-1 * e.length + i); (r = d.exec(t)) !== null;) {
				if (a = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !a) continue;
				if (o = [...a].length, r[3] || r[4]) {
					s += o;
					continue;
				}
				if (r[5] || r[6]) {
					if (i % 3 && !((i + o) % 3)) {
						c += o;
						continue;
					}
					if (u) break;
				}
				if (s -= o, s > 0) continue;
				o = Math.min(o, o + s + c);
				let t = [...r[0]][0].length, n = e.slice(0, i + r.index + t + o);
				if (Math.min(i, o) % 2) {
					let e = n.slice(1, -1);
					return {
						type: "em",
						raw: n,
						text: e,
						tokens: this.lexer.inlineTokens(e)
					};
				}
				let l = n.slice(2, -2);
				return {
					type: "strong",
					raw: n,
					text: l,
					tokens: this.lexer.inlineTokens(l)
				};
			}
		}
	}
	codespan(e) {
		let t = this.rules.inline.code.exec(e);
		if (t) {
			let e = t[2].replace(this.rules.other.newLineCharGlobal, " "), n = this.rules.other.nonSpaceChar.test(e), r = this.rules.other.startingSpaceChar.test(e) && this.rules.other.endingSpaceChar.test(e);
			return n && r && (e = e.substring(1, e.length - 1)), {
				type: "codespan",
				raw: t[0],
				text: e
			};
		}
	}
	br(e) {
		let t = this.rules.inline.br.exec(e);
		if (t) return {
			type: "br",
			raw: t[0]
		};
	}
	del(e, t, n = "") {
		let r = this.rules.inline.delLDelim.exec(e);
		if (r && (!r[1] || !n || this.rules.inline.punctuation.exec(n))) {
			let n = [...r[0]].length - 1, i, a, o = n, s = this.rules.inline.delRDelim;
			for (s.lastIndex = 0, t = t.slice(-1 * e.length + n); (r = s.exec(t)) !== null;) {
				if (i = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !i || (a = [...i].length, a !== n)) continue;
				if (r[3] || r[4]) {
					o += a;
					continue;
				}
				if (o -= a, o > 0) continue;
				a = Math.min(a, a + o);
				let t = [...r[0]][0].length, s = e.slice(0, n + r.index + t + a), c = s.slice(n, -n);
				return {
					type: "del",
					raw: s,
					text: c,
					tokens: this.lexer.inlineTokens(c)
				};
			}
		}
	}
	autolink(e) {
		let t = this.rules.inline.autolink.exec(e);
		if (t) {
			let e, n;
			return t[2] === "@" ? (e = t[1], n = "mailto:" + e) : (e = t[1], n = e), {
				type: "link",
				raw: t[0],
				text: e,
				href: n,
				autolink: !0,
				tokens: [{
					type: "text",
					raw: e,
					text: e
				}]
			};
		}
	}
	url(e) {
		let t;
		if (t = this.rules.inline.url.exec(e)) {
			let e, n;
			if (t[2] === "@") e = t[0], n = "mailto:" + e;
			else {
				let r;
				do
					r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
				while (r !== t[0]);
				e = t[0], n = t[1] === "www." ? "http://" + t[0] : t[0];
			}
			return {
				type: "link",
				raw: t[0],
				text: e,
				href: n,
				autolink: !0,
				tokens: [{
					type: "text",
					raw: e,
					text: e
				}]
			};
		}
	}
	inlineText(e) {
		let t = this.rules.inline.text.exec(e);
		if (t) {
			let e = this.lexer.state.inRawBlock;
			return {
				type: "text",
				raw: t[0],
				text: e ? t[0] : Ar(t[0]),
				escaped: e
			};
		}
	}
}, L = class e {
	tokens;
	options;
	state;
	inlineQueue;
	tokenizer;
	constructor(e) {
		this.tokens = [], this.tokens.links = Object.create(null), this.options = e || cn, this.options.tokenizer = this.options.tokenizer || new Vr(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = {
			inLink: !1,
			inRawBlock: !1,
			linkEmitted: !1,
			linkParenPossible: !0,
			top: !0
		};
		let t = {
			other: P,
			block: Er.normal,
			inline: Dr.normal
		};
		this.options.pedantic ? (t.block = Er.pedantic, t.inline = Dr.pedantic) : this.options.gfm && (t.block = Er.gfm, t.inline = this.options.breaks ? Dr.breaks : Dr.gfm), this.tokenizer.rules = t;
	}
	static get rules() {
		return {
			block: Er,
			inline: Dr
		};
	}
	static lex(t, n) {
		return new e(n).lex(t);
	}
	static lexInline(t, n) {
		return new e(n).inlineTokens(t);
	}
	lex(e) {
		e = e.replace(P.carriageReturn, "\n"), this.blockTokens(e, this.tokens);
		for (let e = 0; e < this.inlineQueue.length; e++) {
			let t = this.inlineQueue[e];
			this.inlineTokens(t.src, t.tokens);
		}
		return this.inlineQueue = [], this.tokens;
	}
	blockTokens(e, t = [], n = !1) {
		this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(P.tabCharGlobal, "    ").replace(P.spaceLine, ""));
		let r = 1 / 0;
		for (; e;) {
			if (e.length < r) r = e.length;
			else {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
			let i;
			if (this.options.extensions?.block?.some((n) => (i = n.call({ lexer: this }, e, t)) ? (e = e.substring(i.raw.length), t.push(i), !0) : !1)) continue;
			if (i = this.tokenizer.space(e)) {
				e = e.substring(i.raw.length);
				let n = t.at(-1);
				i.raw.length === 1 && n !== void 0 ? n.raw += "\n" : t.push(i);
				continue;
			}
			if (i = this.tokenizer.code(e)) {
				e = e.substring(i.raw.length);
				let n = t.at(-1);
				n?.type === "paragraph" || n?.type === "text" ? (n.raw += (n.raw.endsWith("\n") ? "" : "\n") + i.raw, n.text += "\n" + i.text, this.inlineQueue.at(-1).src = n.text) : t.push(i);
				continue;
			}
			if ((i = this.tokenizer.fences(e)) || (i = this.tokenizer.heading(e)) || (i = this.tokenizer.hr(e)) || (i = this.tokenizer.blockquote(e)) || (i = this.tokenizer.list(e)) || (i = this.tokenizer.html(e))) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (i = this.tokenizer.def(e)) {
				e = e.substring(i.raw.length);
				let n = t.at(-1);
				n?.type === "paragraph" || n?.type === "text" ? (n.raw += (n.raw.endsWith("\n") ? "" : "\n") + i.raw, n.text += "\n" + i.raw, this.inlineQueue.at(-1).src = n.text) : this.tokens.links[i.tag] || (this.tokens.links[i.tag] = {
					href: i.href,
					title: i.title
				}, t.push(i));
				continue;
			}
			if ((i = this.tokenizer.table(e)) || (i = this.tokenizer.lheading(e))) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			let a = e;
			if (this.options.extensions?.startBlock) {
				let t = 1 / 0, n = e.slice(1), r;
				this.options.extensions.startBlock.forEach((e) => {
					r = e.call({ lexer: this }, n), typeof r == "number" && r >= 0 && (t = Math.min(t, r));
				}), t < 1 / 0 && t >= 0 && (a = e.substring(0, t + 1));
			}
			if (this.state.top && (i = this.tokenizer.paragraph(a))) {
				let r = t.at(-1);
				n && r?.type === "paragraph" ? (r.raw += (r.raw.endsWith("\n") ? "" : "\n") + i.raw, r.text += "\n" + i.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = r.text) : t.push(i), n = a.length !== e.length, e = e.substring(i.raw.length);
			} else if (i = this.tokenizer.text(e)) {
				e = e.substring(i.raw.length);
				let n = t.at(-1);
				n?.type === "text" ? (n.raw += (n.raw.endsWith("\n") ? "" : "\n") + i.raw, n.text += "\n" + i.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = n.text) : t.push(i);
			} else if (e) {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
		}
		return this.state.top = !0, t;
	}
	inline(e, t = []) {
		return this.inlineQueue.push({
			src: e,
			tokens: t
		}), t;
	}
	linkInText(e) {
		if (!e.includes("[")) return !1;
		let t = this.tokenizer.rules.inline.link;
		for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t.test(n[0]) && e.charAt(n.index - 1) !== "!") return !0;
		for (let t of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
			let e = t[0], n = e.lastIndexOf("[");
			if (e.charAt(0) !== "!" && Object.hasOwn(this.tokens.links, Fr(e.slice(n + 1, -1))) && !(n > 1 && this.linkInText(e.slice(1, n - 1)))) return !0;
		}
		return !1;
	}
	inlineTokens(e, t = []) {
		this.tokenizer.lexer = this;
		let n = this.state.linkParenPossible;
		this.state.linkParenPossible = n && e.includes(")");
		try {
			return this.#e(e, t);
		} finally {
			this.state.linkParenPossible = n;
		}
	}
	#e(e, t) {
		let n = e;
		if (this.tokens.links && e.includes("[")) {
			let e = this.tokenizer.rules.inline.reflinkSearch, t = (n) => {
				let r = n.lastIndexOf("[");
				if (!Object.hasOwn(this.tokens.links, Fr(n.slice(r + 1, -1)))) return n;
				if (r > 1 && n.charAt(0) !== "!") {
					let i = n.slice(1, r - 1);
					if (this.linkInText(i)) return "[" + i.replace(e, t) + "][" + "a".repeat(n.length - r - 2) + "]";
				}
				return "[" + "a".repeat(n.length - 2) + "]";
			};
			n = n.replace(e, t);
		}
		n = n.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode, (e, t, n) => n ? "+".repeat(e.length) : t ? t + e.slice(t.length, -t.length).replace(/`/g, "+") + t : e), n = n.replace(this.tokenizer.rules.inline.blockSkip, (e, t, n) => {
			let r = n ? n.length : 0;
			return e.slice(0, r) + "[" + "a".repeat(e.length - r - 2) + "]";
		}), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
		let r = !1, i = "", a = 1 / 0;
		for (; e;) {
			if (e.length < a) a = e.length;
			else {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
			r || (i = ""), r = !1;
			let o;
			if (this.options.extensions?.inline?.some((n) => (o = n.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), !0) : !1)) continue;
			if ((o = this.tokenizer.escape(e)) || (o = this.tokenizer.tag(e)) || (o = this.tokenizer.link(e))) {
				e = e.substring(o.raw.length), t.push(o);
				continue;
			}
			if (o = this.tokenizer.reflink(e, this.tokens.links)) {
				e = e.substring(o.raw.length);
				let n = t.at(-1);
				o.type === "text" && n?.type === "text" ? (n.raw += o.raw, n.text += o.text) : t.push(o);
				continue;
			}
			if ((o = this.tokenizer.emStrong(e, n, i)) || (o = this.tokenizer.codespan(e)) || (o = this.tokenizer.br(e)) || (o = this.tokenizer.del(e, n, i)) || (o = this.tokenizer.autolink(e)) || !this.state.inLink && (o = this.tokenizer.url(e))) {
				e = e.substring(o.raw.length), t.push(o);
				continue;
			}
			let s = e;
			if (this.options.extensions?.startInline) {
				let t = 1 / 0, n = e.slice(1), r;
				this.options.extensions.startInline.forEach((e) => {
					r = e.call({ lexer: this }, n), typeof r == "number" && r >= 0 && (t = Math.min(t, r));
				}), t < 1 / 0 && t >= 0 && (s = e.substring(0, t + 1));
			}
			if (o = this.tokenizer.inlineText(s)) {
				e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (i = o.raw.slice(-1)), r = !0;
				let n = t.at(-1);
				n?.type === "text" ? (n.raw += o.raw, n.text += o.text) : t.push(o);
			} else if (e) {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
		}
		return t;
	}
	infiniteLoopError(e) {
		let t = "Infinite loop on byte: " + e;
		if (this.options.silent) console.error(t);
		else throw Error(t);
	}
}, Hr = class {
	options;
	parser;
	constructor(e) {
		this.options = e || cn;
	}
	space(e) {
		return "";
	}
	code({ text: e, lang: t, escaped: n }) {
		let r = (t || "").match(P.notSpaceStart)?.[0], i = e ? e.replace(P.endingNewline, "") + "\n" : "";
		return r ? "<pre><code class=\"language-" + I(r) + "\">" + (n ? i : I(i, !0)) + "</code></pre>\n" : "<pre><code>" + (n ? i : I(i, !0)) + "</code></pre>\n";
	}
	blockquote({ tokens: e }) {
		return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
	}
	html({ text: e }) {
		return e;
	}
	def(e) {
		return "";
	}
	heading({ tokens: e, depth: t }) {
		return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
	}
	hr(e) {
		return "<hr>\n";
	}
	list(e) {
		let t = e.ordered, n = e.start, r = "";
		for (let t = 0; t < e.items.length; t++) {
			let n = e.items[t];
			r += this.listitem(n);
		}
		let i = t ? "ol" : "ul", a = t && n !== 1 ? " start=\"" + n + "\"" : "";
		return "<" + i + a + ">\n" + r + "</" + i + ">\n";
	}
	listitem(e) {
		return `<li>${this.parser.parse(e.tokens)}</li>
`;
	}
	checkbox({ checked: e }) {
		return "<input " + (e ? "checked=\"\" " : "") + "disabled=\"\" type=\"checkbox\"> ";
	}
	paragraph({ tokens: e }) {
		return `<p>${this.parser.parseInline(e)}</p>
`;
	}
	table(e) {
		let t = "", n = "";
		for (let t = 0; t < e.header.length; t++) n += this.tablecell(e.header[t]);
		t += this.tablerow({ text: n });
		let r = "";
		for (let t = 0; t < e.rows.length; t++) {
			let i = e.rows[t];
			n = "";
			for (let e = 0; e < i.length; e++) n += this.tablecell(i[e]);
			r += this.tablerow({ text: n });
		}
		return r &&= `<tbody>${r}</tbody>`, "<table>\n<thead>\n" + t + "</thead>\n" + r + "</table>\n";
	}
	tablerow({ text: e }) {
		return `<tr>
${e}</tr>
`;
	}
	tablecell(e) {
		let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
		return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
	}
	strong({ tokens: e }) {
		return `<strong>${this.parser.parseInline(e)}</strong>`;
	}
	em({ tokens: e }) {
		return `<em>${this.parser.parseInline(e)}</em>`;
	}
	codespan({ text: e }) {
		return `<code>${I(e, !0)}</code>`;
	}
	br(e) {
		return "<br>";
	}
	del({ tokens: e }) {
		return `<del>${this.parser.parseInline(e)}</del>`;
	}
	link({ href: e, title: t, text: n, tokens: r, autolink: i }) {
		let a = i ? I(n, !0) : this.parser.parseInline(r), o = jr(e);
		if (o === null) return a;
		e = I(o, i);
		let s = "<a href=\"" + e + "\"";
		return t && (s += " title=\"" + I(t) + "\""), s += ">" + a + "</a>", s;
	}
	image({ href: e, title: t, text: n, tokens: r }) {
		r && (n = this.parser.parseInline(r, this.parser.textRenderer));
		let i = jr(e);
		if (i === null) return I(n);
		e = i;
		let a = `<img src="${I(e)}" alt="${I(n)}"`;
		return t && (a += ` title="${I(t)}"`), a += ">", a;
	}
	text(e) {
		return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : I(e.text);
	}
}, Ur = class {
	strong({ text: e }) {
		return e;
	}
	em({ text: e }) {
		return e;
	}
	codespan({ text: e }) {
		return e;
	}
	del({ text: e }) {
		return e;
	}
	html({ text: e }) {
		return e;
	}
	text({ text: e }) {
		return e;
	}
	link({ text: e }) {
		return "" + e;
	}
	image({ text: e }) {
		return "" + e;
	}
	br() {
		return "";
	}
	checkbox({ raw: e }) {
		return e;
	}
}, R = class e {
	options;
	renderer;
	textRenderer;
	constructor(e) {
		this.options = e || cn, this.options.renderer = this.options.renderer || new Hr(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new Ur();
	}
	static parse(t, n) {
		return new e(n).parse(t);
	}
	static parseInline(t, n) {
		return new e(n).parseInline(t);
	}
	parse(e) {
		this.renderer.parser = this;
		let t = "";
		for (let n = 0; n < e.length; n++) {
			let r = e[n];
			if (this.options.extensions?.renderers?.[r.type]) {
				let e = r, n = this.options.extensions.renderers[e.type].call({ parser: this }, e);
				if (n !== !1 || ![
					"space",
					"hr",
					"heading",
					"code",
					"table",
					"blockquote",
					"list",
					"checkbox",
					"html",
					"def",
					"paragraph",
					"text"
				].includes(e.type)) {
					t += n || "";
					continue;
				}
			}
			let i = r;
			switch (i.type) {
				case "space":
					t += this.renderer.space(i);
					break;
				case "hr":
					t += this.renderer.hr(i);
					break;
				case "heading":
					t += this.renderer.heading(i);
					break;
				case "code":
					t += this.renderer.code(i);
					break;
				case "table":
					t += this.renderer.table(i);
					break;
				case "blockquote":
					t += this.renderer.blockquote(i);
					break;
				case "list":
					t += this.renderer.list(i);
					break;
				case "checkbox":
					t += this.renderer.checkbox(i);
					break;
				case "html":
					t += this.renderer.html(i);
					break;
				case "def":
					t += this.renderer.def(i);
					break;
				case "paragraph":
					t += this.renderer.paragraph(i);
					break;
				case "text":
					t += this.renderer.text(i);
					break;
				default: {
					let e = "Token with \"" + i.type + "\" type was not found.";
					if (this.options.silent) return console.error(e), "";
					throw Error(e);
				}
			}
		}
		return t;
	}
	parseInline(e, t = this.renderer) {
		this.renderer.parser = this;
		let n = "";
		for (let r = 0; r < e.length; r++) {
			let i = e[r];
			if (this.options.extensions?.renderers?.[i.type]) {
				let e = this.options.extensions.renderers[i.type].call({ parser: this }, i);
				if (e !== !1 || ![
					"escape",
					"html",
					"link",
					"image",
					"checkbox",
					"strong",
					"em",
					"codespan",
					"br",
					"del",
					"text"
				].includes(i.type)) {
					n += e || "";
					continue;
				}
			}
			let a = i;
			switch (a.type) {
				case "escape":
					n += t.text(a);
					break;
				case "html":
					n += t.html(a);
					break;
				case "link":
					n += t.link(a);
					break;
				case "image":
					n += t.image(a);
					break;
				case "checkbox":
					n += t.checkbox(a);
					break;
				case "strong":
					n += t.strong(a);
					break;
				case "em":
					n += t.em(a);
					break;
				case "codespan":
					n += t.codespan(a);
					break;
				case "br":
					n += t.br(a);
					break;
				case "del":
					n += t.del(a);
					break;
				case "text":
					n += t.text(a);
					break;
				default: {
					let e = "Token with \"" + a.type + "\" type was not found.";
					if (this.options.silent) return console.error(e), "";
					throw Error(e);
				}
			}
		}
		return n;
	}
}, Wr = class {
	options;
	block;
	constructor(e) {
		this.options = e || cn;
	}
	static passThroughHooks = /* @__PURE__ */ new Set([
		"preprocess",
		"postprocess",
		"processAllTokens",
		"emStrongMask"
	]);
	static passThroughHooksRespectAsync = /* @__PURE__ */ new Set([
		"preprocess",
		"postprocess",
		"processAllTokens"
	]);
	preprocess(e) {
		return e;
	}
	postprocess(e) {
		return e;
	}
	processAllTokens(e) {
		return e;
	}
	emStrongMask(e) {
		return e;
	}
	provideLexer(e = this.block) {
		return e ? L.lex : L.lexInline;
	}
	provideParser(e = this.block) {
		return e ? R.parse : R.parseInline;
	}
};
function Gr(e, t) {
	if (Array.isArray(t)) for (let n = 0; n < t.length; n++) e.push(t[n]);
	else e.push(t);
}
var Kr = class {
	defaults = sn();
	options = this.setOptions;
	parse = this.parseMarkdown(!0);
	parseInline = this.parseMarkdown(!1);
	Parser = R;
	Renderer = Hr;
	TextRenderer = Ur;
	Lexer = L;
	Tokenizer = Vr;
	Hooks = Wr;
	constructor(...e) {
		this.use(...e);
	}
	walkTokens(e, t) {
		let n = [];
		for (let r of e) switch (Gr(n, t.call(this, r)), r.type) {
			case "table": {
				let e = r;
				for (let r of e.header) Gr(n, this.walkTokens(r.tokens, t));
				for (let r of e.rows) for (let e of r) Gr(n, this.walkTokens(e.tokens, t));
				break;
			}
			case "list": {
				let e = r;
				Gr(n, this.walkTokens(e.items, t));
				break;
			}
			default: {
				let e = r;
				this.defaults.extensions?.childTokens?.[e.type] ? this.defaults.extensions.childTokens[e.type].forEach((r) => {
					let i = e[r].flat(1 / 0);
					Gr(n, this.walkTokens(i, t));
				}) : e.tokens && Gr(n, this.walkTokens(e.tokens, t));
			}
		}
		return n;
	}
	use(...e) {
		let t = this.defaults.extensions || {
			renderers: {},
			childTokens: {}
		};
		return e.forEach((e) => {
			let n = { ...e };
			if (n.async = this.defaults.async || n.async || !1, e.extensions && (e.extensions.forEach((e) => {
				if (!e.name) throw Error("extension name required");
				if ("renderer" in e) {
					let n = t.renderers[e.name];
					n ? t.renderers[e.name] = function(...t) {
						let r = e.renderer.apply(this, t);
						return r === !1 && (r = n.apply(this, t)), r;
					} : t.renderers[e.name] = e.renderer;
				}
				if ("tokenizer" in e) {
					if (!e.level || e.level !== "block" && e.level !== "inline") throw Error("extension level must be 'block' or 'inline'");
					let n = t[e.level];
					n ? n.unshift(e.tokenizer) : t[e.level] = [e.tokenizer], e.start && (e.level === "block" ? t.startBlock ? t.startBlock.push(e.start) : t.startBlock = [e.start] : e.level === "inline" && (t.startInline ? t.startInline.push(e.start) : t.startInline = [e.start]));
				}
				"childTokens" in e && e.childTokens && (t.childTokens[e.name] = e.childTokens);
			}), n.extensions = t), e.renderer) {
				let t = this.defaults.renderer || new Hr(this.defaults);
				for (let n in e.renderer) {
					if (!(n in t)) throw Error(`renderer '${n}' does not exist`);
					if (["options", "parser"].includes(n)) continue;
					let r = n, i = e.renderer[r], a = t[r];
					t[r] = (...e) => {
						let n = i.apply(t, e);
						return n === !1 && (n = a.apply(t, e)), n || "";
					};
				}
				n.renderer = t;
			}
			if (e.tokenizer) {
				let t = this.defaults.tokenizer || new Vr(this.defaults);
				for (let n in e.tokenizer) {
					if (!(n in t)) throw Error(`tokenizer '${n}' does not exist`);
					if ([
						"options",
						"rules",
						"lexer"
					].includes(n)) continue;
					let r = n, i = e.tokenizer[r], a = t[r];
					t[r] = (...e) => {
						let n = i.apply(t, e);
						return n === !1 && (n = a.apply(t, e)), n;
					};
				}
				n.tokenizer = t;
			}
			if (e.hooks) {
				let t = this.defaults.hooks || new Wr();
				for (let n in e.hooks) {
					if (!(n in t)) throw Error(`hook '${n}' does not exist`);
					if (["options", "block"].includes(n)) continue;
					let r = n, i = e.hooks[r], a = t[r];
					t[r] = Wr.passThroughHooks.has(n) ? (e) => {
						if (this.defaults.async && Wr.passThroughHooksRespectAsync.has(n)) return (async () => {
							let n = await i.call(t, e);
							return a.call(t, n);
						})();
						let r = i.call(t, e);
						return a.call(t, r);
					} : (...e) => {
						if (this.defaults.async) return (async () => {
							let n = await i.apply(t, e);
							return n === !1 && (n = await a.apply(t, e)), n;
						})();
						let n = i.apply(t, e);
						return n === !1 && (n = a.apply(t, e)), n;
					};
				}
				n.hooks = t;
			}
			if (e.walkTokens) {
				let t = this.defaults.walkTokens, r = e.walkTokens;
				n.walkTokens = function(e) {
					let n = [];
					return n.push(r.call(this, e)), t && Gr(n, t.call(this, e)), n;
				};
			}
			this.defaults = {
				...this.defaults,
				...n
			};
		}), this;
	}
	setOptions(e) {
		return this.defaults = {
			...this.defaults,
			...e
		}, this;
	}
	lexer(e, t) {
		return L.lex(e, t ?? this.defaults);
	}
	parser(e, t) {
		return R.parse(e, t ?? this.defaults);
	}
	parseMarkdown(e) {
		return (t, n) => {
			let r = { ...n }, i = {
				...this.defaults,
				...r
			}, a = this.onError(!!i.silent, !!i.async);
			if (this.defaults.async === !0 && r.async === !1) return a(/* @__PURE__ */ Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
			if (typeof t > "u" || t === null) return a(/* @__PURE__ */ Error("marked(): input parameter is undefined or null"));
			if (typeof t != "string") return a(/* @__PURE__ */ Error("marked(): input parameter is of type " + Object.prototype.toString.call(t) + ", string expected"));
			if (i.hooks && (i.hooks.options = i, i.hooks.block = e), i.async) return (async () => {
				let n = i.hooks ? await i.hooks.preprocess(t) : t, r = await (i.hooks ? await i.hooks.provideLexer(e) : e ? L.lex : L.lexInline)(n, i), a = i.hooks ? await i.hooks.processAllTokens(r) : r;
				i.walkTokens && await Promise.all(this.walkTokens(a, i.walkTokens));
				let o = await (i.hooks ? await i.hooks.provideParser(e) : e ? R.parse : R.parseInline)(a, i);
				return i.hooks ? await i.hooks.postprocess(o) : o;
			})().catch(a);
			try {
				i.hooks && (t = i.hooks.preprocess(t));
				let n = (i.hooks ? i.hooks.provideLexer(e) : e ? L.lex : L.lexInline)(t, i);
				i.hooks && (n = i.hooks.processAllTokens(n)), i.walkTokens && this.walkTokens(n, i.walkTokens);
				let r = (i.hooks ? i.hooks.provideParser(e) : e ? R.parse : R.parseInline)(n, i);
				return i.hooks && (r = i.hooks.postprocess(r)), r;
			} catch (e) {
				return a(e);
			}
		};
	}
	onError(e, t) {
		return (n) => {
			if (n.message += "\nPlease report this to https://github.com/markedjs/marked.", e) {
				let e = "<p>An error occurred:</p><pre>" + I(n.message + "", !0) + "</pre>";
				return t ? Promise.resolve(e) : e;
			}
			if (t) return Promise.reject(n);
			throw n;
		};
	}
}, qr = new Kr();
function z(e, t) {
	return qr.parse(e, t);
}
z.options = z.setOptions = function(e) {
	return qr.setOptions(e), z.defaults = qr.defaults, ln(z.defaults), z;
}, z.getDefaults = sn, z.defaults = cn;
function Jr(...e) {
	return qr.use(...e), z.defaults = qr.defaults, ln(z.defaults), z;
}
z.use = Jr, z.walkTokens = function(e, t) {
	return qr.walkTokens(e, t);
}, z.parseInline = qr.parseInline, z.Parser = R, z.parser = R.parse, z.Renderer = Hr, z.TextRenderer = Ur, z.Lexer = L, z.lexer = L.lex, z.Tokenizer = Vr, z.Hooks = Wr, z.parse = z, z.options, z.setOptions, z.walkTokens, z.parseInline, R.parse, L.lex;
// node_modules/@formdown/core/dist/body-html.js
var Yr = /<!--FORMDOWN_(?:FIELD|GROUP_START|GROUP_END)_[^>]*?-->/g, Xr = /^\s*(?:javascript|vbscript|data):/i;
function Zr({ text: e, block: t }) {
	let n = "", r = 0, i = (e) => e.trim() ? t ? `<p>${M(e.trim())}</p>\n` : M(e) : e;
	for (let t of e.matchAll(Yr)) n += i(e.slice(r, t.index)) + t[0], r = t.index + t[0].length;
	return n + i(e.slice(r));
}
var Qr = new Kr({ renderer: {
	html: Zr,
	link(e) {
		return Xr.test(e.href) ? this.parser.parseInline(e.tokens) : !1;
	},
	image(e) {
		return Xr.test(e.href) ? M(e.text) : !1;
	}
} });
function $r(e, t = "trust") {
	return (t === "escape" ? Qr : z).parse(e, { async: !1 });
}
// node_modules/@formdown/core/dist/generator.js
var ei = (e) => console.warn(`[Formdown] ${e}`), ti = class {
	constructor(e = {}) {
		this.options = e, this.formCounter = 0, this.fieldCounter = 0, this.usedIds = /* @__PURE__ */ new Set();
	}
	unlistedValues(e, t) {
		return [...new Set(e.filter((e) => e !== "" && !(t ?? []).some((t) => t.value === e)))];
	}
	renderAttribute(e, t) {
		return /^[^\s"'>/=\u0000-\u001F]+$/.test(e) ? `${e}="${M(String(t))}"` : "";
	}
	generateSmartLabel(e) {
		if (/^\d/.test(e)) throw Error(`Invalid field name '${e}': Field names cannot start with a number`);
		return gt(e);
	}
	determineFormId(e, t) {
		if (e.attributes?.form) return e.attributes.form;
		if (t) return t;
		if (!t) return this.generateDefaultFormId();
	}
	generateDefaultFormId() {
		return this.formCounter === 0 ? "formdown-form-default" : `formdown-form-${this.formCounter++}`;
	}
	ensureDefaultForm(e, t) {
		return t.length === 0 ? e : e.length === 0 ? [{
			id: this.generateDefaultFormId(),
			attributes: {}
		}] : e;
	}
	createFormContext(e, t) {
		let n = /* @__PURE__ */ new Map();
		if (t.length === 0) return n;
		let r = [...t].sort((e, t) => (e.position || 0) - (t.position || 0)), i = r[0].id;
		return e.forEach((e) => {
			if (e.attributes?.form) {
				let r = e.attributes.form;
				t.some((e) => e.id === r) ? n.set(e, r) : (console.warn(`Form '${r}' referenced by field '${e.name}' does not exist. Using default form.`), n.set(e, i));
			} else {
				let t = this.findNearestForm(e, r);
				n.set(e, t?.id || i);
			}
		}), n;
	}
	findNearestForm(e, t) {
		if (!e.position) return t[0];
		let n;
		for (let r of t) if (!r.position || r.position <= e.position) n = r;
		else break;
		return n || t[0];
	}
	generateHTML(e, t = {}) {
		let n = j().transformSync("pre-generate", {}, e, ei), r = this.renderHTML(n, t.html ?? this.options.html);
		return j().transformSync("post-generate", {}, r, ei);
	}
	renderField(e, t) {
		return j().transformSync("field-render", { field: e }, t, ei);
	}
	renderHTML(e, t) {
		this.usedIds.clear(), this.fieldCounter = 0;
		let n = e.markdown ? $r(e.markdown, t) : "";
		return this.processContentWithHiddenForms(n, e.forms, e.formDeclarations || [], e.datalistDeclarations || [], e.groupDeclarations || []);
	}
	processContentWithHiddenForms(e, t, n, r, i = []) {
		if (t.length === 0 && n.length === 0 && r.length === 0 && i.length === 0) return e;
		let a = this.ensureDefaultForm(n, t), o = this.generateHiddenFormsHTML(a), s = this.generateDatalistHTML(r), c = this.createFormContext(t, a), l = /* @__PURE__ */ new Map();
		i.forEach((e) => l.set(e.id, e));
		let u = [], d = [];
		t.forEach((e) => {
			e.inline ? u.push(e) : d.push(e);
		});
		let f = e;
		return i.forEach((e) => {
			let t = `<!--FORMDOWN_GROUP_START_${e.id}-->`, n = this.generateGroupStartHTML(e);
			f = f.replace(new RegExp(this.escapeRegex(t), "g"), n);
		}), i.forEach((e) => {
			let t = `<!--FORMDOWN_GROUP_END_${e.id}-->`;
			f = f.replace(new RegExp(this.escapeRegex(t), "g"), "</fieldset>");
		}), u.forEach((e, n) => {
			let r = `<!--FORMDOWN_FIELD_${t.indexOf(e)}-->`, i = c.get(e), a = this.renderField(e, this.generateInlineFieldHTML(e, i));
			f = f.replace(new RegExp(this.escapeRegex(r), "g"), a);
		}), d.forEach((e) => {
			let n = `<!--FORMDOWN_FIELD_${t.indexOf(e)}-->`, r = c.get(e), i = this.renderField(e, this.generateStandaloneFieldHTML(e, r));
			f = f.replace(new RegExp(this.escapeRegex(n), "g"), i);
		}), o + s + f;
	}
	generateGroupStartHTML(e) {
		let t = M(e.label), n = ["class=\"formdown-group\"", `data-group="${M(e.id)}"`];
		return e.collapsible && n.push("data-collapsible=\"true\""), e.collapsed && n.push("data-collapsed=\"true\""), `<fieldset ${n.join(" ")}>\n<legend>${t}</legend>`;
	}
	escapeRegex(e) {
		return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	processContent(e, t) {
		if (t.length === 0) return e;
		let n = [], r = [];
		t.forEach((e) => {
			e.inline ? n.push(e) : r.push(e);
		});
		let i = e;
		return n.forEach((e, n) => {
			let r = `<!--FORMDOWN_FIELD_${t.indexOf(e)}-->`, a = this.renderField(e, this.generateInlineFieldHTML(e));
			i = i.replace(new RegExp(r, "g"), a);
		}), r.forEach((e) => {
			let n = `<!--FORMDOWN_FIELD_${t.indexOf(e)}-->`, r = this.renderField(e, this.generateStandaloneFieldHTML(e));
			i = i.replace(new RegExp(n, "g"), r);
		}), i;
	}
	processFieldPlaceholders(e, t) {
		let n = e;
		return t.forEach((e, t) => {
			let r = `<!--FORMDOWN_FIELD_${t}-->`, i = this.renderField(e, this.generateStandaloneFieldHTML(e));
			n = n.replace(new RegExp(r, "g"), i);
		}), n;
	}
	generateStandaloneFieldHTML(e, t) {
		if (e.inline) return this.generateInlineFieldHTML(e, t);
		let n = this.generateFieldHTML(e, t);
		if (/<div class="formdown-field(?:\s[^"]*)?"/.test(n) || [
			"submit",
			"reset",
			"button"
		].includes(e.type)) return `
<div class="formdown-field-container">
${n}
</div>`;
		let r = this.generateUniqueId(e.name, t), i = e.label || this.generateSmartLabel(e.name), a = this.determineFormId(e, t), o = e.required ? " *" : "";
		return `
<div class="formdown-field-container">
<div class="formdown-field">
    <label for="${r}">${M(i)}${o}</label>
    ${n.replace(/id="[^"]*"/, `id="${r}"`).replace(/form="[^"]*"/, a ? `form="${a}"` : "")}
</div>
</div>`;
	}
	generateInlineFieldHTML(e, t) {
		let { name: n, type: r, required: i, placeholder: a, attributes: o } = e, s = e.label || this.generateSmartLabel(n), c = this.determineFormId(e, t), l = {
			contenteditable: "true",
			"data-field-name": n,
			"data-field-type": r,
			"data-placeholder": a || s,
			class: "formdown-inline-field",
			role: "textbox",
			...i && { "data-required": "true" },
			...c && { "data-form": c },
			...o && Object.fromEntries(Object.entries(o).filter(([e]) => e !== "form"))
		}, u = Object.entries(l).map(([e, t]) => typeof t == "boolean" ? t ? e : "" : this.renderAttribute(e, t)).filter(Boolean).join(" "), d = e.value ?? o?.value;
		return `<span ${u}>${M(d == null || d === "" ? s : String(d))}</span>`;
	}
	generateFieldHTML(e, t) {
		let { name: n, type: r, label: i, required: a, placeholder: o, attributes: s, options: c, description: l, pattern: u, format: d, allowOther: f, content: p, value: m } = e, h = {
			field: e,
			metadata: { formId: t }
		}, g = null;
		try {
			g = j().getFieldTypeRegistry().generateFieldHTML(e, h);
		} catch (t) {
			ei(`The '${e.type}' field type failed to render "${e.name}": ${t instanceof Error ? t.message : String(t)}`);
		}
		if (g) return g;
		let _ = i || this.generateSmartLabel(n), v = M(_), y = r === "checkbox" ? p || i || this.generateSmartLabel(n) : _, b = this.generateUniqueId(n, t), x = l ? `${b}-description` : void 0, S = this.determineFormId(e, t), ee = {
			name: "name",
			first_name: "given-name",
			last_name: "family-name",
			email: "email",
			phone: "tel",
			phone_number: "tel",
			password: "current-password",
			new_password: "new-password",
			confirm_password: "new-password",
			username: "username",
			company: "organization",
			address: "street-address",
			city: "address-level2",
			state: "address-level1",
			zip: "postal-code",
			country: "country",
			birth_date: "bday",
			birthday: "bday"
		}[n.toLowerCase()] || (r === "email" ? "email" : r === "tel" ? "tel" : r === "password" ? "current-password" : void 0), te = /* @__PURE__ */ new Set(["width", "span"]), ne = s ? Object.fromEntries(Object.entries(s).filter(([e]) => !te.has(e) && !e.startsWith("--"))) : {}, re = {
			id: b,
			name: n,
			...a && { required: !0 },
			...o && { placeholder: o },
			...u && { pattern: u },
			...d && { format: d },
			...m != null && ![
				"textarea",
				"select",
				"radio",
				"checkbox",
				"range",
				"file"
			].includes(r) && { value: m },
			...l && { "aria-describedby": x },
			...S && { form: S },
			...ee && !s?.autocomplete && { autocomplete: ee },
			...e.compute && {
				readonly: !0,
				"data-compute": e.compute
			},
			...ne
		}, C = Object.entries(re).map(([e, t]) => typeof t == "boolean" ? t ? e : "" : this.renderAttribute(e, t)).filter(Boolean).join(" "), w = () => {
			let e = "";
			return l && (e += `\n    <div id="${x}" class="formdown-field-description" part="description">${M(l)}</div>`), e;
		}, T = (() => {
			let t = ["formdown-field"], n = [];
			if (e.conditions) {
				if (t.push("formdown-conditional"), e.conditions.visibleIf) {
					let t = e.conditions.visibleIf;
					n.push(`data-visible-if-field="${M(t.field)}"`), n.push(`data-visible-if-operator="${t.operator}"`), t.value !== void 0 && n.push(`data-visible-if-value="${M(t.value)}"`);
				}
				if (e.conditions.hiddenIf) {
					let t = e.conditions.hiddenIf;
					n.push(`data-hidden-if-field="${M(t.field)}"`), n.push(`data-hidden-if-operator="${t.operator}"`), t.value !== void 0 && n.push(`data-hidden-if-value="${M(t.value)}"`);
				}
				if (e.conditions.enabledIf) {
					let t = e.conditions.enabledIf;
					n.push(`data-enabled-if-field="${M(t.field)}"`), n.push(`data-enabled-if-operator="${t.operator}"`), t.value !== void 0 && n.push(`data-enabled-if-value="${M(t.value)}"`);
				}
				if (e.conditions.disabledIf) {
					let t = e.conditions.disabledIf;
					n.push(`data-disabled-if-field="${M(t.field)}"`), n.push(`data-disabled-if-operator="${t.operator}"`), t.value !== void 0 && n.push(`data-disabled-if-value="${M(t.value)}"`);
				}
				if (e.conditions.requiredIf) {
					let t = e.conditions.requiredIf;
					n.push(`data-required-if-field="${M(t.field)}"`), n.push(`data-required-if-operator="${t.operator}"`), t.value !== void 0 && n.push(`data-required-if-value="${M(t.value)}"`);
				}
			}
			e.group && n.push(`data-group="${M(e.group)}"`);
			let r = [];
			return e.attributes && (e.attributes.width !== void 0 && r.push(`width: ${M(String(e.attributes.width))}`), e.attributes.span !== void 0 && r.push(`grid-column: span ${M(String(e.attributes.span))}`), Object.entries(e.attributes).forEach(([e, t]) => {
				e.startsWith("--") && r.push(`${e}: ${M(String(t))}`);
			})), `${`class="${t.join(" ")}"`}${r.length > 0 ? ` style="${r.join("; ")}"` : ""}${n.length > 0 ? ` ${n.join(" ")}` : ""}`;
		})();
		switch (r) {
			case "textarea":
				let i = m ? M(String(m)) : "";
				return `
<div ${T} part="field">
    <label for="${b}" part="label">${v}${a ? " *" : ""}</label>
    <textarea ${C} part="input textarea-input">${i}</textarea>${w()}
</div>`;
			case "select":
				let o = c?.map((e) => {
					let t = m && String(m) === e.value ? " selected" : "";
					return `<option value="${M(e.value)}"${t}>${M(tt(e))}</option>`;
				}).join("\n") || "", l = f ? "" : this.unlistedValues(m ? [String(m)] : [], c).map((e) => {
					let t = M(e);
					return `\n        <option value="${t}" selected data-formdown-unlisted="true">${t}</option>`;
				}).join(""), u = f ? `\n        <option value="">${M(e.otherLabel || "Other")} (please specify)</option>` : "", d = f ? `\n    <input type="text" id="${b}_other" placeholder="Please specify..." class="formdown-other-input" data-formdown-other-for="${b}">` : "";
				return `
<div ${T} part="field">
    <label for="${b}" part="label">${v}${a ? " *" : ""}</label>
    <select ${C} part="input select-input"${f ? ` data-formdown-has-other="true" data-formdown-other-target="${b}_other"` : ""}>
        ${o}${l}${u}
    </select>${d}${w()}
</div>`;
			case "radio":
				if (!c || c.length === 0) return `
<div ${T}>
    <label for="${b}">${v}${a ? " *" : ""}</label>
    <input type="text" ${C}>${w()}
</div>`;
				let p = c.map((e, r) => {
					let i = this.generateUniqueId(`${n}_${r}`, t), o = a && r === 0, s = m && String(m) === e.value, c = f ? " data-formdown-hides-other=\"true\"" : "", l = o ? " required" : "", u = s ? " checked" : "", d = x ? ` aria-describedby="${x}"` : "";
					return `
        <label for="${i}" class="formdown-option-label" part="option-label">
            <input type="radio" id="${i}" name="${n}" value="${M(e.value)}"${l}${u}${d}${c}>
            <span>${M(tt(e))}</span>
        </label>`;
				}).join("\n"), h = f ? "" : this.unlistedValues(m ? [String(m)] : [], c).map((e, r) => {
					let i = this.generateUniqueId(`${n}_unlisted_${r}`, t), a = x ? ` aria-describedby="${x}"` : "", o = M(e);
					return `
        <label for="${i}" class="formdown-option-label" part="option-label">
            <input type="radio" id="${i}" name="${n}" value="${o}" checked${a} data-formdown-unlisted="true">
            <span>${o}</span>
        </label>`;
				}).join(""), g = this.generateUniqueId(`${n}_other_radio`, t), _ = f ? `
        <label for="${g}" class="formdown-option-label" part="option-label">
            <input type="radio" id="${g}" name="${n}" value="" ${x ? `aria-describedby="${x}"` : ""} data-formdown-other-radio="true">
            <span>${M(e.otherLabel || "Other")}:</span>
            <input type="text" placeholder="Please specify..." class="formdown-other-input" data-formdown-other-for="${n}">
        </label>` : "", ee = s?.layout === "vertical" ? "radio-group vertical" : "radio-group inline";
				return `
<div ${T} part="field">
    <fieldset ${x ? `aria-describedby="${x}"` : ""} part="fieldset">
        <legend part="legend">${v}${a ? " *" : ""}</legend>
        <div class="${ee}" role="radiogroup" part="radio-group">
${p}${h}${_}
        </div>
    </fieldset>${w()}
</div>`;
			case "checkbox":
				if (!c || c.length === 0) {
					let t = m && (m === !0 || m === "true" || String(m).toLowerCase() === "true"), r = { ...re };
					delete r.id, delete r.name, delete r.form;
					let i = Object.entries(r).map(([e, t]) => typeof t == "boolean" ? t ? e : "" : this.renderAttribute(e, t)).filter(Boolean).join(" ");
					return `
<div ${T} part="field">
    <label for="${b}" class="formdown-checkbox-label" part="label checkbox-label">
        <input type="checkbox" id="${b}" name="${n}" value="true"${a ? " required" : ""}${t ? " checked" : ""}${S ? ` form="${S}"` : ""}${on(e) ? " role=\"switch\"" : ""} ${i} part="input checkbox-input">
        <span>${M(y)}${a ? " *" : ""}</span>
    </label>${w()}
</div>`;
				}
				{
					let r = Array.isArray(m) ? m.map(String) : m ? String(m).split(",").map((e) => e.trim()) : [], i = c.map((e, i) => {
						let o = this.generateUniqueId(`${n}_${i}`, t), s = a && i === 0, c = r.includes(e.value), l = s ? " required" : "", u = c ? " checked" : "", d = x ? ` aria-describedby="${x}"` : "";
						return `
        <label for="${o}" class="formdown-option-label" part="option-label">
            <input type="checkbox" id="${o}" name="${n}" value="${M(e.value)}"${l}${u}${d}>
            <span>${M(tt(e))}</span>
        </label>`;
					}).join("\n"), o = f ? "" : this.unlistedValues(r, c).map((e, r) => {
						let i = this.generateUniqueId(`${n}_unlisted_${r}`, t), a = x ? ` aria-describedby="${x}"` : "", o = M(e);
						return `
        <label for="${i}" class="formdown-option-label" part="option-label">
            <input type="checkbox" id="${i}" name="${n}" value="${o}" checked${a} data-formdown-unlisted="true">
            <span>${o}</span>
        </label>`;
					}).join(""), l = this.generateUniqueId(`${n}_other_checkbox`, t), u = f ? `
        <label for="${l}" class="formdown-option-label" part="option-label">
            <input type="checkbox" id="${l}" name="${n}" value="" ${x ? `aria-describedby="${x}"` : ""} data-formdown-other-checkbox="true">
            <span>${M(e.otherLabel || "Other")}:</span>
            <input type="text" placeholder="Please specify..." class="formdown-other-input" data-formdown-other-for="${n}">
        </label>` : "", d = s?.layout === "vertical" ? "checkbox-group vertical" : "checkbox-group inline";
					return `
<div ${T} part="field">
    <fieldset ${x ? `aria-describedby="${x}"` : ""} part="fieldset">
        <legend part="legend">${v}${a ? " *" : ""}</legend>
        <div class="${d}" role="group" part="checkbox-group">
${i}${o}${u}
        </div>
    </fieldset>${w()}
</div>`;
				}
			case "range":
				let te = Number(s?.min) || 0, ne = Number(s?.max) || 100;
				Number(s?.step);
				let ie = m === void 0 ? s?.value === void 0 ? Math.floor((te + ne) / 2) : Number(s.value) : m;
				return `
<div ${T} part="field">
    <label for="${b}" part="label">${v}${a ? " *" : ""}</label>
    <input type="range" ${C} value="${ie}" part="input range-input">
    <output for="${b}" class="formdown-range-output" part="range-output">${ie}</output>${w()}
</div>`;
			case "file": return `
<div ${T} part="field">
    <label for="${b}" part="label">${v}${a ? " *" : ""}</label>
    <input type="file" ${C} part="input file-input">${w()}
</div>`;
			case "color": return `
<div ${T} part="field">
    <label for="${b}" part="label">${v}${a ? " *" : ""}</label>
    <input type="color" ${C} part="input color-input">${w()}
</div>`;
			case "week": return `
<div ${T} part="field">
    <label for="${b}" part="label">${v}${a ? " *" : ""}</label>
    <input type="week" ${C} part="input week-input">${w()}
</div>`;
			case "month": return `
<div ${T} part="field">
    <label for="${b}" part="label">${v}${a ? " *" : ""}</label>
    <input type="month" ${C} part="input month-input">${w()}
</div>`;
			case "submit":
				let ae = S ? ` form="${S}"` : "", oe = Object.entries(s || {}).filter(([e]) => !["form"].includes(e)).map(([e, t]) => typeof t == "boolean" ? t ? e : "" : this.renderAttribute(e, t)).filter(Boolean).join(" ");
				return `<button type="submit" id="${b}"${ae}${oe ? ` ${oe}` : ""} part="button submit-button">${e.label || "Submit"}</button>`;
			case "reset":
				let se = S ? ` form="${S}"` : "", ce = Object.entries(s || {}).filter(([e]) => !["form"].includes(e)).map(([e, t]) => typeof t == "boolean" ? t ? e : "" : this.renderAttribute(e, t)).filter(Boolean).join(" ");
				return `<button type="reset" id="${b}"${se}${ce ? ` ${ce}` : ""} part="button reset-button">${e.label || "Reset"}</button>`;
			case "button":
				let le = s?.type || "button", ue = S ? ` form="${S}"` : "", E = Object.entries(s || {}).filter(([e]) => !["form", "type"].includes(e)).map(([e, t]) => typeof t == "boolean" ? t ? e : "" : this.renderAttribute(e, t)).filter(Boolean).join(" ");
				return `<button type="${le}" id="${b}"${ue}${E ? ` ${E}` : ""} part="button">${e.label || "Button"}</button>`;
			case "image":
				let de = s?.src || "", fe = s?.alt || e.label || "Submit", pe = S ? ` form="${S}"` : "", me = Object.entries(s || {}).filter(([e]) => ![
					"form",
					"src",
					"alt",
					"type"
				].includes(e)).map(([e, t]) => typeof t == "boolean" ? t ? e : "" : this.renderAttribute(e, t)).filter(Boolean).join(" ");
				return `<input type="image" id="${b}" src="${de}" alt="${fe}"${pe}${me ? ` ${me}` : ""}>`;
			default: return `
<div ${T} part="field">
    <label for="${b}" part="label">${v}${a ? " *" : ""}</label>
    <input type="${r}" ${C} part="input text-input">${w()}
</div>`;
		}
	}
	generateHiddenFormsHTML(e) {
		return e.length === 0 ? "" : e.map((e) => this.generateHiddenFormHTML(e)).join("");
	}
	generateHiddenFormHTML(e) {
		let t = [], n = [], r = [];
		Object.entries(e.attributes).forEach(([e, i]) => {
			typeof i == "boolean" ? i && r.push(e) : e === "layout" ? t.push(`data-layout="${M(String(i))}"`) : e === "label-width" ? n.push(`--formdown-label-width: ${M(String(i))}`) : e === "columns" ? n.push(`--formdown-columns: ${M(String(i))}`) : e === "gap" ? n.push(`--formdown-gap: ${M(String(i))}`) : e.startsWith("--") ? n.push(`${e}: ${M(String(i))}`) : r.push(`${e}="${M(String(i))}"`);
		});
		let i = [...t, ...r];
		n.length > 0 && i.push(`style="${n.join("; ")}"`);
		let a = i.filter(Boolean).join(" ");
		return `<form hidden id="${e.id}" ${a}></form>\n`;
	}
	generateDatalistHTML(e) {
		return e.length === 0 ? "" : e.map((e) => this.generateSingleDatalistHTML(e)).join("");
	}
	generateSingleDatalistHTML(e) {
		let t = e.options.map((e) => `<option value="${M(e)}">${M(e)}</option>`).join("");
		return `<datalist id="${e.id}">${t}</datalist>\n`;
	}
	generateUniqueId(e, t) {
		let n = e;
		for (this.usedIds.has(n) && t && (n = `${t.replace(/^formdown-form-/, "").replace(/-/g, "_")}_${e}`), this.usedIds.has(n) && (n = `${e}_${++this.fieldCounter}`); this.usedIds.has(n);) n = `${e}_${++this.fieldCounter}`;
		return this.usedIds.add(n), n;
	}
}, ni = Symbol.for("yaml.alias"), ri = Symbol.for("yaml.document"), ii = Symbol.for("yaml.map"), ai = Symbol.for("yaml.pair"), B = Symbol.for("yaml.scalar"), oi = Symbol.for("yaml.seq"), V = Symbol.for("yaml.node.type"), si = (e) => !!e && typeof e == "object" && e[V] === ni, ci = (e) => !!e && typeof e == "object" && e[V] === ri, li = (e) => !!e && typeof e == "object" && e[V] === ii, H = (e) => !!e && typeof e == "object" && e[V] === ai, U = (e) => !!e && typeof e == "object" && e[V] === B, ui = (e) => !!e && typeof e == "object" && e[V] === oi;
function W(e) {
	if (e && typeof e == "object") switch (e[V]) {
		case ii:
		case oi: return !0;
	}
	return !1;
}
function G(e) {
	if (e && typeof e == "object") switch (e[V]) {
		case ni:
		case ii:
		case B:
		case oi: return !0;
	}
	return !1;
}
var di = (e) => (U(e) || W(e)) && !!e.anchor, fi = Symbol("break visit"), pi = Symbol("skip children"), mi = Symbol("remove node");
function hi(e, t) {
	let n = _i(t);
	ci(e) ? gi(null, e.contents, n, Object.freeze([e])) === mi && (e.contents = null) : gi(null, e, n, Object.freeze([]));
}
hi.BREAK = fi, hi.SKIP = pi, hi.REMOVE = mi;
function gi(e, t, n, r) {
	let i = vi(e, t, n, r);
	if (G(i) || H(i)) return yi(e, r, i), gi(e, i, n, r);
	if (typeof i != "symbol") {
		if (W(t)) {
			r = Object.freeze(r.concat(t));
			for (let e = 0; e < t.items.length; ++e) {
				let i = gi(e, t.items[e], n, r);
				if (typeof i == "number") e = i - 1;
				else if (i === fi) return fi;
				else i === mi && (t.items.splice(e, 1), --e);
			}
		} else if (H(t)) {
			r = Object.freeze(r.concat(t));
			let e = gi("key", t.key, n, r);
			if (e === fi) return fi;
			e === mi && (t.key = null);
			let i = gi("value", t.value, n, r);
			if (i === fi) return fi;
			i === mi && (t.value = null);
		}
	}
	return i;
}
function _i(e) {
	return typeof e == "object" && (e.Collection || e.Node || e.Value) ? Object.assign({
		Alias: e.Node,
		Map: e.Node,
		Scalar: e.Node,
		Seq: e.Node
	}, e.Value && {
		Map: e.Value,
		Scalar: e.Value,
		Seq: e.Value
	}, e.Collection && {
		Map: e.Collection,
		Seq: e.Collection
	}, e) : e;
}
function vi(e, t, n, r) {
	if (typeof n == "function") return n(e, t, r);
	if (li(t)) return n.Map?.(e, t, r);
	if (ui(t)) return n.Seq?.(e, t, r);
	if (H(t)) return n.Pair?.(e, t, r);
	if (U(t)) return n.Scalar?.(e, t, r);
	if (si(t)) return n.Alias?.(e, t, r);
}
function yi(e, t, n) {
	let r = t[t.length - 1];
	if (W(r)) r.items[e] = n;
	else if (H(r)) e === "key" ? r.key = n : r.value = n;
	else if (ci(r)) r.contents = n;
	else {
		let e = si(r) ? "alias" : "scalar";
		throw Error(`Cannot replace node with ${e} parent`);
	}
}
// node_modules/yaml/browser/dist/doc/directives.js
var bi = {
	"!": "%21",
	",": "%2C",
	"[": "%5B",
	"]": "%5D",
	"{": "%7B",
	"}": "%7D"
}, xi = (e) => e.replace(/[!,[\]{}]/g, (e) => bi[e]), Si = class e {
	constructor(t, n) {
		this.docStart = null, this.docEnd = !1, this.yaml = Object.assign({}, e.defaultYaml, t), this.tags = Object.assign({}, e.defaultTags, n);
	}
	clone() {
		let t = new e(this.yaml, this.tags);
		return t.docStart = this.docStart, t;
	}
	atDocument() {
		let t = new e(this.yaml, this.tags);
		switch (this.yaml.version) {
			case "1.1":
				this.atNextDocument = !0;
				break;
			case "1.2": this.atNextDocument = !1, this.yaml = {
				explicit: e.defaultYaml.explicit,
				version: "1.2"
			}, this.tags = Object.assign({}, e.defaultTags);
		}
		return t;
	}
	add(t, n) {
		this.atNextDocument &&= (this.yaml = {
			explicit: e.defaultYaml.explicit,
			version: "1.1"
		}, this.tags = Object.assign({}, e.defaultTags), !1);
		let r = t.trim().split(/[ \t]+/), i = r.shift();
		switch (i) {
			case "%TAG": {
				if (r.length !== 2 && (n(0, "%TAG directive should contain exactly two parts"), r.length < 2)) return !1;
				let [e, t] = r;
				return this.tags[e] = t, !0;
			}
			case "%YAML": {
				if (this.yaml.explicit = !0, r.length !== 1) return n(0, "%YAML directive should contain exactly one part"), !1;
				let [e] = r;
				if (e === "1.1" || e === "1.2") return this.yaml.version = e, !0;
				{
					let t = /^\d+\.\d+$/.test(e);
					return n(6, `Unsupported YAML version ${e}`, t), !1;
				}
			}
			default: return n(0, `Unknown directive ${i}`, !0), !1;
		}
	}
	tagName(e, t) {
		if (e === "!") return "!";
		if (e[0] !== "!") return t(`Not a valid tag: ${e}`), null;
		if (e[1] === "<") {
			let n = e.slice(2, -1);
			return n === "!" || n === "!!" ? (t(`Verbatim tags aren't resolved, so ${e} is invalid.`), null) : (e[e.length - 1] !== ">" && t("Verbatim tags must end with a >"), n);
		}
		let [, n, r] = e.match(/^(.*!)([^!]*)$/s);
		r || t(`The ${e} tag has no suffix`);
		let i = this.tags[n];
		if (i) try {
			return i + decodeURIComponent(r);
		} catch (e) {
			return t(String(e)), null;
		}
		return n === "!" ? e : (t(`Could not resolve tag: ${e}`), null);
	}
	tagString(e) {
		for (let [t, n] of Object.entries(this.tags)) if (e.startsWith(n)) return t + xi(e.substring(n.length));
		return e[0] === "!" ? e : `!<${e}>`;
	}
	toString(e) {
		let t = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [], n = Object.entries(this.tags), r;
		if (e && n.length > 0 && G(e.contents)) {
			let t = {};
			hi(e.contents, (e, n) => {
				G(n) && n.tag && (t[n.tag] = !0);
			}), r = Object.keys(t);
		} else r = [];
		for (let [i, a] of n) i === "!!" && a === "tag:yaml.org,2002:" || e && !r.some((e) => e.startsWith(a)) || t.push(`%TAG ${i} ${a}`);
		return t.join("\n");
	}
};
Si.defaultYaml = {
	explicit: !1,
	version: "1.2"
}, Si.defaultTags = { "!!": "tag:yaml.org,2002:" };
// node_modules/yaml/browser/dist/doc/anchors.js
function Ci(e) {
	if (/[\x00-\x19\s,[\]{}]/.test(e)) {
		let t = `Anchor must not contain whitespace or control characters: ${JSON.stringify(e)}`;
		throw Error(t);
	}
	return !0;
}
function wi(e) {
	let t = /* @__PURE__ */ new Set();
	return hi(e, { Value(e, n) {
		n.anchor && t.add(n.anchor);
	} }), t;
}
function Ti(e, t) {
	for (let n = 1;; ++n) {
		let r = `${e}${n}`;
		if (!t.has(r)) return r;
	}
}
function Ei(e, t) {
	let n = [], r = /* @__PURE__ */ new Map(), i = null;
	return {
		onAnchor: (r) => {
			n.push(r), i ??= wi(e);
			let a = Ti(t, i);
			return i.add(a), a;
		},
		setAnchors: () => {
			for (let e of n) {
				let t = r.get(e);
				if (typeof t == "object" && t.anchor && (U(t.node) || W(t.node))) t.node.anchor = t.anchor;
				else {
					let t = /* @__PURE__ */ Error("Failed to resolve repeated object (this should not happen)");
					throw t.source = e, t;
				}
			}
		},
		sourceObjects: r
	};
}
// node_modules/yaml/browser/dist/doc/applyReviver.js
function Di(e, t, n, r) {
	if (r && typeof r == "object") {
		if (Array.isArray(r)) for (let t = 0, n = r.length; t < n; ++t) {
			let n = r[t], i = Di(e, r, String(t), n);
			i === void 0 ? delete r[t] : i !== n && (r[t] = i);
		}
		else if (r instanceof Map) for (let t of Array.from(r.keys())) {
			let n = r.get(t), i = Di(e, r, t, n);
			i === void 0 ? r.delete(t) : i !== n && r.set(t, i);
		}
		else if (r instanceof Set) for (let t of Array.from(r)) {
			let n = Di(e, r, t, t);
			n === void 0 ? r.delete(t) : n !== t && (r.delete(t), r.add(n));
		}
		else for (let [t, n] of Object.entries(r)) {
			let i = Di(e, r, t, n);
			i === void 0 ? delete r[t] : i !== n && (r[t] = i);
		}
	}
	return e.call(t, n, r);
}
// node_modules/yaml/browser/dist/nodes/toJS.js
function K(e, t, n) {
	if (Array.isArray(e)) return e.map((e, t) => K(e, String(t), n));
	if (e && typeof e.toJSON == "function") {
		if (!n || !di(e)) return e.toJSON(t, n);
		let r = {
			aliasCount: 0,
			count: 1,
			res: void 0
		};
		n.anchors.set(e, r), n.onCreate = (e) => {
			r.res = e, delete n.onCreate;
		};
		let i = e.toJSON(t, n);
		return n.onCreate && n.onCreate(i), i;
	}
	return typeof e == "bigint" && !n?.keep ? Number(e) : e;
}
// node_modules/yaml/browser/dist/nodes/Node.js
var Oi = class {
	constructor(e) {
		Object.defineProperty(this, V, { value: e });
	}
	clone() {
		let e = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
		return this.range && (e.range = this.range.slice()), e;
	}
	toJS(e, { mapAsMap: t, maxAliasCount: n, onAnchor: r, reviver: i } = {}) {
		if (!ci(e)) throw TypeError("A document argument is required");
		let a = {
			anchors: /* @__PURE__ */ new Map(),
			doc: e,
			keep: !0,
			mapAsMap: t === !0,
			mapKeyWarned: !1,
			maxAliasCount: typeof n == "number" ? n : 100
		}, o = K(this, "", a);
		if (typeof r == "function") for (let { count: e, res: t } of a.anchors.values()) r(t, e);
		return typeof i == "function" ? Di(i, { "": o }, "", o) : o;
	}
}, ki = class extends Oi {
	constructor(e) {
		super(ni), this.source = e, Object.defineProperty(this, "tag", { set() {
			throw Error("Alias nodes cannot have tags");
		} });
	}
	resolve(e, t) {
		if (t?.maxAliasCount === 0) throw ReferenceError("Alias resolution is disabled");
		let n;
		t?.aliasResolveCache ? n = t.aliasResolveCache : (n = [], hi(e, { Node: (e, t) => {
			(si(t) || di(t)) && n.push(t);
		} }), t && (t.aliasResolveCache = n));
		let r;
		for (let e of n) {
			if (e === this) break;
			e.anchor === this.source && (r = e);
		}
		if (r && t) {
			let { anchors: e, doc: n, maxAliasCount: i } = t, a = e.get(r);
			/* istanbul ignore if */
			if (a ||= (K(r, null, t), e.get(r)), a?.res === void 0) throw ReferenceError("This should not happen: Alias anchor was not resolved?");
			if (i >= 0 && (a.count += 1, a.aliasCount === 0 && (a.aliasCount = Ai(n, r, e)), a.count * a.aliasCount > i)) throw ReferenceError("Excessive alias count indicates a resource exhaustion attack");
		}
		return r;
	}
	toJSON(e, t) {
		if (!t) return { source: this.source };
		let n = this.resolve(t.doc, t);
		if (!n) {
			let e = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
			throw ReferenceError(e);
		}
		return t.anchors.get(n).res;
	}
	toString(e, t, n) {
		let r = `*${this.source}`;
		if (e) {
			if (Ci(this.source), e.options.verifyAliasOrder && !e.anchors.has(this.source)) {
				let e = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw Error(e);
			}
			if (e.implicitKey) return `${r} `;
		}
		return r;
	}
};
function Ai(e, t, n) {
	if (si(t)) {
		let r = t.resolve(e), i = n && r && n.get(r);
		return i ? i.count * i.aliasCount : 0;
	}
	if (W(t)) {
		let r = 0;
		for (let i of t.items) {
			let t = Ai(e, i, n);
			t > r && (r = t);
		}
		return r;
	}
	if (H(t)) {
		let r = Ai(e, t.key, n), i = Ai(e, t.value, n);
		return Math.max(r, i);
	}
	return 1;
}
// node_modules/yaml/browser/dist/nodes/Scalar.js
var ji = (e) => !e || typeof e != "function" && typeof e != "object", q = class extends Oi {
	constructor(e) {
		super(B), this.value = e;
	}
	toJSON(e, t) {
		return t?.keep ? this.value : K(this.value, e, t);
	}
	toString() {
		return String(this.value);
	}
};
q.BLOCK_FOLDED = "BLOCK_FOLDED", q.BLOCK_LITERAL = "BLOCK_LITERAL", q.PLAIN = "PLAIN", q.QUOTE_DOUBLE = "QUOTE_DOUBLE", q.QUOTE_SINGLE = "QUOTE_SINGLE";
// node_modules/yaml/browser/dist/doc/createNode.js
var Mi = "tag:yaml.org,2002:";
function Ni(e, t, n) {
	if (t) {
		let e = n.filter((e) => e.tag === t), r = e.find((e) => !e.format) ?? e[0];
		if (!r) throw Error(`Tag ${t} not found`);
		return r;
	}
	return n.find((t) => t.identify?.(e) && !t.format);
}
function Pi(e, t, n) {
	if (ci(e) && (e = e.contents), G(e)) return e;
	if (H(e)) {
		let t = n.schema[ii].createNode?.(n.schema, null, n);
		return t.items.push(e), t;
	}
	(e instanceof String || e instanceof Number || e instanceof Boolean || typeof BigInt < "u" && e instanceof BigInt) && (e = e.valueOf());
	let { aliasDuplicateObjects: r, onAnchor: i, onTagObj: a, schema: o, sourceObjects: s } = n, c;
	if (r && e && typeof e == "object") {
		if (c = s.get(e), c) return c.anchor ?? (c.anchor = i(e)), new ki(c.anchor);
		c = {
			anchor: null,
			node: null
		}, s.set(e, c);
	}
	t?.startsWith("!!") && (t = Mi + t.slice(2));
	let l = Ni(e, t, o.tags);
	if (!l) {
		if (e && typeof e.toJSON == "function" && (e = e.toJSON()), !e || typeof e != "object") {
			let t = new q(e);
			return c && (c.node = t), t;
		}
		l = e instanceof Map ? o[ii] : Symbol.iterator in Object(e) ? o[oi] : o[ii];
	}
	a && (a(l), delete n.onTagObj);
	let u = l?.createNode ? l.createNode(n.schema, e, n) : typeof l?.nodeClass?.from == "function" ? l.nodeClass.from(n.schema, e, n) : new q(e);
	return t ? u.tag = t : l.default || (u.tag = l.tag), c && (c.node = u), u;
}
// node_modules/yaml/browser/dist/nodes/Collection.js
function Fi(e, t, n) {
	let r = n;
	for (let e = t.length - 1; e >= 0; --e) {
		let n = t[e];
		if (typeof n == "number" && Number.isInteger(n) && n >= 0) {
			let e = [];
			e[n] = r, r = e;
		} else r = /* @__PURE__ */ new Map([[n, r]]);
	}
	return Pi(r, void 0, {
		aliasDuplicateObjects: !1,
		keepUndefined: !1,
		onAnchor: () => {
			throw Error("This should not happen, please report a bug.");
		},
		schema: e,
		sourceObjects: /* @__PURE__ */ new Map()
	});
}
var Ii = (e) => e == null || typeof e == "object" && !!e[Symbol.iterator]().next().done, Li = class extends Oi {
	constructor(e, t) {
		super(e), Object.defineProperty(this, "schema", {
			value: t,
			configurable: !0,
			enumerable: !1,
			writable: !0
		});
	}
	clone(e) {
		let t = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
		return e && (t.schema = e), t.items = t.items.map((t) => G(t) || H(t) ? t.clone(e) : t), this.range && (t.range = this.range.slice()), t;
	}
	addIn(e, t) {
		if (Ii(e)) this.add(t);
		else {
			let [n, ...r] = e, i = this.get(n, !0);
			if (W(i)) i.addIn(r, t);
			else if (i === void 0 && this.schema) this.set(n, Fi(this.schema, r, t));
			else throw Error(`Expected YAML collection at ${n}. Remaining path: ${r}`);
		}
	}
	deleteIn(e) {
		let [t, ...n] = e;
		if (n.length === 0) return this.delete(t);
		let r = this.get(t, !0);
		if (W(r)) return r.deleteIn(n);
		throw Error(`Expected YAML collection at ${t}. Remaining path: ${n}`);
	}
	getIn(e, t) {
		let [n, ...r] = e, i = this.get(n, !0);
		return r.length === 0 ? !t && U(i) ? i.value : i : W(i) ? i.getIn(r, t) : void 0;
	}
	hasAllNullValues(e) {
		return this.items.every((t) => {
			if (!H(t)) return !1;
			let n = t.value;
			return n == null || e && U(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
		});
	}
	hasIn(e) {
		let [t, ...n] = e;
		if (n.length === 0) return this.has(t);
		let r = this.get(t, !0);
		return W(r) ? r.hasIn(n) : !1;
	}
	setIn(e, t) {
		let [n, ...r] = e;
		if (r.length === 0) this.set(n, t);
		else {
			let e = this.get(n, !0);
			if (W(e)) e.setIn(r, t);
			else if (e === void 0 && this.schema) this.set(n, Fi(this.schema, r, t));
			else throw Error(`Expected YAML collection at ${n}. Remaining path: ${r}`);
		}
	}
}, Ri = (e) => e.replace(/^(?!$)(?: $)?/gm, "#");
function zi(e, t) {
	return /^\n+$/.test(e) ? e.substring(1) : t ? e.replace(/^(?! *$)/gm, t) : e;
}
var Bi = (e, t, n) => e.endsWith("\n") ? zi(n, t) : n.includes("\n") ? "\n" + zi(n, t) : (e.endsWith(" ") ? "" : " ") + n, Vi = "flow", Hi = "block", Ui = "quoted";
function Wi(e, t, n = "flow", { indentAtStart: r, lineWidth: i = 80, minContentWidth: a = 20, onFold: o, onOverflow: s } = {}) {
	if (!i || i < 0) return e;
	i < a && (a = 0);
	let c = Math.max(1 + a, 1 + i - t.length);
	if (e.length <= c) return e;
	let l = [], u = {}, d = i - t.length;
	typeof r == "number" && (r > i - Math.max(2, a) ? l.push(0) : d = i - r);
	let f, p, m = !1, h = -1, g = -1, _ = -1;
	n === "block" && (h = Gi(e, h, t.length), h !== -1 && (d = h + c));
	for (let r; r = e[h += 1];) {
		if (n === "quoted" && r === "\\") {
			switch (g = h, e[h + 1]) {
				case "x":
					h += 3;
					break;
				case "u":
					h += 5;
					break;
				case "U":
					h += 9;
					break;
				default: h += 1;
			}
			_ = h;
		}
		if (r === "\n") n === "block" && (h = Gi(e, h, t.length)), d = h + t.length + c, f = void 0;
		else {
			if (r === " " && p && p !== " " && p !== "\n" && p !== "	") {
				let t = e[h + 1];
				t && t !== " " && t !== "\n" && t !== "	" && (f = h);
			}
			if (h >= d) {
				if (f) l.push(f), d = f + c, f = void 0;
				else if (n === "quoted") {
					for (; p === " " || p === "	";) p = r, r = e[h += 1], m = !0;
					let t = h > _ + 1 ? h - 2 : g - 1;
					if (u[t]) return e;
					l.push(t), u[t] = !0, d = t + c, f = void 0;
				} else m = !0;
			}
		}
		p = r;
	}
	if (m && s && s(), l.length === 0) return e;
	o && o();
	let v = e.slice(0, l[0]);
	for (let r = 0; r < l.length; ++r) {
		let i = l[r], a = l[r + 1] || e.length;
		i === 0 ? v = `\n${t}${e.slice(0, a)}` : (n === "quoted" && u[i] && (v += `${e[i]}\\`), v += `\n${t}${e.slice(i + 1, a)}`);
	}
	return v;
}
function Gi(e, t, n) {
	let r = t, i = t + 1, a = e[i];
	for (; a === " " || a === "	";) if (t < i + n) a = e[++t];
	else {
		do
			a = e[++t];
		while (a && a !== "\n");
		r = t, i = t + 1, a = e[i];
	}
	return r;
}
// node_modules/yaml/browser/dist/stringify/stringifyString.js
var Ki = (e, t) => ({
	indentAtStart: t ? e.indent.length : e.indentAtStart,
	lineWidth: e.options.lineWidth,
	minContentWidth: e.options.minContentWidth
}), qi = (e) => /^(%|---|\.\.\.)/m.test(e);
function Ji(e, t, n) {
	if (!t || t < 0) return !1;
	let r = t - n, i = e.length;
	if (i <= r) return !1;
	for (let t = 0, n = 0; t < i; ++t) if (e[t] === "\n") {
		if (t - n > r) return !0;
		if (n = t + 1, i - n <= r) return !1;
	}
	return !0;
}
function Yi(e, t) {
	let n = JSON.stringify(e);
	if (t.options.doubleQuotedAsJSON) return n;
	let { implicitKey: r } = t, i = t.options.doubleQuotedMinMultiLineLength, a = t.indent || (qi(e) ? "  " : ""), o = "", s = 0;
	for (let e = 0, t = n[e]; t; t = n[++e]) if (t === " " && n[e + 1] === "\\" && n[e + 2] === "n" && (o += n.slice(s, e) + "\\ ", e += 1, s = e, t = "\\"), t === "\\") switch (n[e + 1]) {
		case "u":
			{
				o += n.slice(s, e);
				let t = n.substr(e + 2, 4);
				switch (t) {
					case "0000":
						o += "\\0";
						break;
					case "0007":
						o += "\\a";
						break;
					case "000b":
						o += "\\v";
						break;
					case "001b":
						o += "\\e";
						break;
					case "0085":
						o += "\\N";
						break;
					case "00a0":
						o += "\\_";
						break;
					case "2028":
						o += "\\L";
						break;
					case "2029":
						o += "\\P";
						break;
					default: t.substr(0, 2) === "00" ? o += "\\x" + t.substr(2) : o += n.substr(e, 6);
				}
				e += 5, s = e + 1;
			}
			break;
		case "n":
			if (r || n[e + 2] === "\"" || n.length < i) e += 1;
			else {
				for (o += n.slice(s, e) + "\n\n"; n[e + 2] === "\\" && n[e + 3] === "n" && n[e + 4] !== "\"";) o += "\n", e += 2;
				o += a, n[e + 2] === " " && (o += "\\"), e += 1, s = e + 1;
			}
			break;
		default: e += 1;
	}
	return o = s ? o + n.slice(s) : n, r ? o : Wi(o, a, Ui, Ki(t, !1));
}
function Xi(e, t) {
	if (t.options.singleQuote === !1 || t.implicitKey && e.includes("\n") || /[ \t]\n|\n[ \t]/.test(e)) return Yi(e, t);
	let n = t.indent || (qi(e) ? "  " : ""), r = "'" + e.replace(/'/g, "''").replace(/\n+/g, `$&\n${n}`) + "'";
	return t.implicitKey ? r : Wi(r, n, Vi, Ki(t, !1));
}
function Zi(e, t) {
	let { singleQuote: n } = t.options, r;
	if (n === !1) r = Yi;
	else {
		let t = e.includes("\""), i = e.includes("'");
		r = t && !i ? Xi : i && !t ? Yi : n ? Xi : Yi;
	}
	return r(e, t);
}
var Qi;
try {
	Qi = /* @__PURE__ */ RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
} catch {
	Qi = /\n+(?!\n|$)/g;
}
function $i({ comment: e, type: t, value: n }, r, i, a) {
	let { blockQuote: o, commentString: s, lineWidth: c } = r.options;
	if (!o || /\n[\t ]+$/.test(n)) return Zi(n, r);
	let l = r.indent || (r.forceBlockIndent || qi(n) ? "  " : ""), u = o === "literal" ? !0 : o === "folded" || t === q.BLOCK_FOLDED ? !1 : t === q.BLOCK_LITERAL || !Ji(n, c, l.length);
	if (!n) return u ? "|\n" : ">\n";
	let d, f;
	for (f = n.length; f > 0; --f) {
		let e = n[f - 1];
		if (e !== "\n" && e !== "	" && e !== " ") break;
	}
	let p = n.substring(f), m = p.indexOf("\n");
	m === -1 ? d = "-" : n === p || m !== p.length - 1 ? (d = "+", a && a()) : d = "", p &&= (n = n.slice(0, -p.length), p[p.length - 1] === "\n" && (p = p.slice(0, -1)), p.replace(Qi, `$&${l}`));
	let h = !1, g, _ = -1;
	for (g = 0; g < n.length; ++g) {
		let e = n[g];
		if (e === " ") h = !0;
		else if (e === "\n") _ = g;
		else break;
	}
	let v = n.substring(0, _ < g ? _ + 1 : g);
	v &&= (n = n.substring(v.length), v.replace(/\n+/g, `$&${l}`));
	let y = (h ? l ? "2" : "1" : "") + d;
	if (e && (y += " " + s(e.replace(/ ?[\r\n]+/g, " ")), i && i()), !u) {
		let e = n.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${l}`), i = !1, a = Ki(r, !0);
		o !== "folded" && t !== q.BLOCK_FOLDED && (a.onOverflow = () => {
			i = !0;
		});
		let s = Wi(`${v}${e}${p}`, l, Hi, a);
		if (!i) return `>${y}\n${l}${s}`;
	}
	return n = n.replace(/\n+/g, `$&${l}`), `|${y}\n${l}${v}${n}${p}`;
}
function ea(e, t, n, r) {
	let { type: i, value: a } = e, { actualString: o, implicitKey: s, indent: c, indentStep: l, inFlow: u } = t;
	if (s && a.includes("\n") || u && /[[\]{},]/.test(a)) return Zi(a, t);
	if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(a)) return s || u || !a.includes("\n") ? Zi(a, t) : $i(e, t, n, r);
	if (!s && !u && i !== q.PLAIN && a.includes("\n")) return $i(e, t, n, r);
	if (qi(a)) {
		if (c === "") return t.forceBlockIndent = !0, $i(e, t, n, r);
		if (s && c === l) return Zi(a, t);
	}
	let d = a.replace(/\n+/g, `$&\n${c}`);
	if (o) {
		let e = (e) => e.default && e.tag !== "tag:yaml.org,2002:str" && e.test?.test(d), { compat: n, tags: r } = t.doc.schema;
		if (r.some(e) || n?.some(e)) return Zi(a, t);
	}
	return s ? d : Wi(d, c, Vi, Ki(t, !1));
}
function ta(e, t, n, r) {
	let { implicitKey: i, inFlow: a } = t, o = typeof e.value == "string" ? e : Object.assign({}, e, { value: String(e.value) }), { type: s } = e;
	s !== q.QUOTE_DOUBLE && /[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(o.value) && (s = q.QUOTE_DOUBLE);
	let c = (e) => {
		switch (e) {
			case q.BLOCK_FOLDED:
			case q.BLOCK_LITERAL: return i || a ? Zi(o.value, t) : $i(o, t, n, r);
			case q.QUOTE_DOUBLE: return Yi(o.value, t);
			case q.QUOTE_SINGLE: return Xi(o.value, t);
			case q.PLAIN: return ea(o, t, n, r);
			default: return null;
		}
	}, l = c(s);
	if (l === null) {
		let { defaultKeyType: e, defaultStringType: n } = t.options, r = i && e || n;
		if (l = c(r), l === null) throw Error(`Unsupported default string type ${r}`);
	}
	return l;
}
// node_modules/yaml/browser/dist/stringify/stringify.js
function na(e, t) {
	let n = Object.assign({
		blockQuote: !0,
		commentString: Ri,
		defaultKeyType: null,
		defaultStringType: "PLAIN",
		directives: null,
		doubleQuotedAsJSON: !1,
		doubleQuotedMinMultiLineLength: 40,
		falseStr: "false",
		flowCollectionPadding: !0,
		indentSeq: !0,
		lineWidth: 80,
		minContentWidth: 20,
		nullStr: "null",
		simpleKeys: !1,
		singleQuote: null,
		trailingComma: !1,
		trueStr: "true",
		verifyAliasOrder: !0
	}, e.schema.toStringOptions, t), r;
	switch (n.collectionStyle) {
		case "block":
			r = !1;
			break;
		case "flow":
			r = !0;
			break;
		default: r = null;
	}
	return {
		anchors: /* @__PURE__ */ new Set(),
		doc: e,
		flowCollectionPadding: n.flowCollectionPadding ? " " : "",
		indent: "",
		indentStep: typeof n.indent == "number" ? " ".repeat(n.indent) : "  ",
		inFlow: r,
		options: n
	};
}
function ra(e, t) {
	if (t.tag) {
		let n = e.filter((e) => e.tag === t.tag);
		if (n.length > 0) return n.find((e) => e.format === t.format) ?? n[0];
	}
	let n, r;
	if (U(t)) {
		r = t.value;
		let i = e.filter((e) => e.identify?.(r));
		if (i.length > 1) {
			let e = i.filter((e) => e.test);
			e.length > 0 && (i = e);
		}
		n = i.find((e) => e.format === t.format) ?? i.find((e) => !e.format);
	} else r = t, n = e.find((e) => e.nodeClass && r instanceof e.nodeClass);
	if (!n) {
		let e = r?.constructor?.name ?? (r === null ? "null" : typeof r);
		throw Error(`Tag not resolved for ${e} value`);
	}
	return n;
}
function ia(e, t, { anchors: n, doc: r }) {
	if (!r.directives) return "";
	let i = [], a = (U(e) || W(e)) && e.anchor;
	a && Ci(a) && (n.add(a), i.push(`&${a}`));
	let o = e.tag ?? (t.default ? null : t.tag);
	return o && i.push(r.directives.tagString(o)), i.join(" ");
}
function aa(e, t, n, r) {
	if (H(e)) return e.toString(t, n, r);
	if (si(e)) {
		if (t.doc.directives) return e.toString(t);
		if (t.resolvedAliases?.has(e)) throw TypeError("Cannot stringify circular structure without alias nodes");
		t.resolvedAliases ? t.resolvedAliases.add(e) : t.resolvedAliases = /* @__PURE__ */ new Set([e]), e = e.resolve(t.doc);
	}
	let i, a = G(e) ? e : t.doc.createNode(e, { onTagObj: (e) => i = e });
	i ??= ra(t.doc.schema.tags, a);
	let o = ia(a, i, t);
	o.length > 0 && (t.indentAtStart = (t.indentAtStart ?? 0) + o.length + 1);
	let s = typeof i.stringify == "function" ? i.stringify(a, t, n, r) : U(a) ? ta(a, t, n, r) : a.toString(t, n, r);
	return o ? U(a) || s[0] === "{" || s[0] === "[" ? `${o} ${s}` : `${o}\n${t.indent}${s}` : s;
}
// node_modules/yaml/browser/dist/stringify/stringifyPair.js
function oa({ key: e, value: t }, n, r, i) {
	let { allNullValues: a, doc: o, indent: s, indentStep: c, options: { commentString: l, indentSeq: u, simpleKeys: d } } = n, f = G(e) && e.comment || null;
	if (d) {
		if (f) throw Error("With simple keys, key nodes cannot have comments");
		if (W(e) || !G(e) && typeof e == "object") throw Error("With simple keys, collection cannot be used as a key value");
	}
	let p = !d && (!e || f && t == null && !n.inFlow || W(e) || (U(e) ? e.type === q.BLOCK_FOLDED || e.type === q.BLOCK_LITERAL : typeof e == "object"));
	n = Object.assign({}, n, {
		allNullValues: !1,
		implicitKey: !p && (d || !a),
		indent: s + c
	});
	let m = !1, h = !1, g = aa(e, n, () => m = !0, () => h = !0);
	if (!p && !n.inFlow && g.length > 1024) {
		if (d) throw Error("With simple keys, single line scalar must not span more than 1024 characters");
		p = !0;
	}
	if (n.inFlow) {
		if (a || t == null) return m && r && r(), g === "" ? "?" : p ? `? ${g}` : g;
	} else if (a && !d || t == null && p) return g = `? ${g}`, f && !m ? g += Bi(g, n.indent, l(f)) : h && i && i(), g;
	m && (f = null), p ? (f && (g += Bi(g, n.indent, l(f))), g = `? ${g}\n${s}:`) : (g = `${g}:`, f && (g += Bi(g, n.indent, l(f))));
	let _, v, y;
	G(t) ? (_ = !!t.spaceBefore, v = t.commentBefore, y = t.comment) : (_ = !1, v = null, y = null, t && typeof t == "object" && (t = o.createNode(t))), n.implicitKey = !1, !p && !f && U(t) && (n.indentAtStart = g.length + 1), h = !1, !u && c.length >= 2 && !n.inFlow && !p && ui(t) && !t.flow && !t.tag && !t.anchor && (n.indent = n.indent.substring(2));
	let b = !1, x = aa(t, n, () => b = !0, () => h = !0), S = " ";
	if (f || _ || v) {
		if (S = _ ? "\n" : "", v) {
			let e = l(v);
			S += `\n${zi(e, n.indent)}`;
		}
		x === "" && !n.inFlow ? S === "\n" && y && (S = "\n\n") : S += `\n${n.indent}`;
	} else if (!p && W(t)) {
		let e = x[0], r = x.indexOf("\n"), i = r !== -1, a = n.inFlow ?? t.flow ?? t.items.length === 0;
		if (i || !a) {
			let t = !1;
			if (i && (e === "&" || e === "!")) {
				let n = x.indexOf(" ");
				e === "&" && n !== -1 && n < r && x[n + 1] === "!" && (n = x.indexOf(" ", n + 1)), (n === -1 || r < n) && (t = !0);
			}
			t || (S = `\n${n.indent}`);
		}
	} else (x === "" || x[0] === "\n") && (S = "");
	return g += S + x, n.inFlow ? b && r && r() : y && !b ? g += Bi(g, n.indent, l(y)) : h && i && i(), g;
}
// node_modules/yaml/browser/dist/log.js
function sa(e, t) {
	(e === "debug" || e === "warn") && console.warn(t);
}
// node_modules/yaml/browser/dist/schema/yaml-1.1/merge.js
var ca = "<<", la = {
	identify: (e) => e === ca || typeof e == "symbol" && e.description === ca,
	default: "key",
	tag: "tag:yaml.org,2002:merge",
	test: /^<<$/,
	resolve: () => Object.assign(new q(Symbol(ca)), { addToJSMap: da }),
	stringify: () => ca
}, ua = (e, t) => (la.identify(t) || U(t) && (!t.type || t.type === q.PLAIN) && la.identify(t.value)) && e?.doc.schema.tags.some((e) => e.tag === la.tag && e.default);
function da(e, t, n) {
	let r = pa(e, n);
	if (ui(r)) for (let n of r.items) fa(e, t, n);
	else if (Array.isArray(r)) for (let n of r) fa(e, t, n);
	else fa(e, t, r);
}
function fa(e, t, n) {
	let r = pa(e, n);
	if (!li(r)) throw Error("Merge sources must be maps or map aliases");
	let i = r.toJSON(null, e, Map);
	for (let [e, n] of i) t instanceof Map ? t.has(e) || t.set(e, n) : t instanceof Set ? t.add(e) : Object.prototype.hasOwnProperty.call(t, e) || Object.defineProperty(t, e, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
	return t;
}
function pa(e, t) {
	return e && si(t) ? t.resolve(e.doc, e) : t;
}
// node_modules/yaml/browser/dist/nodes/addPairToJSMap.js
function ma(e, t, { key: n, value: r }) {
	if (G(n) && n.addToJSMap) n.addToJSMap(e, t, r);
	else if (ua(e, n)) da(e, t, r);
	else {
		let i = K(n, "", e);
		if (t instanceof Map) t.set(i, K(r, i, e));
		else if (t instanceof Set) t.add(i);
		else {
			let a = ha(n, i, e), o = K(r, a, e);
			a in t ? Object.defineProperty(t, a, {
				value: o,
				writable: !0,
				enumerable: !0,
				configurable: !0
			}) : t[a] = o;
		}
	}
	return t;
}
function ha(e, t, n) {
	if (t === null) return "";
	if (typeof t != "object") return String(t);
	if (G(e) && n?.doc) {
		let t = na(n.doc, {});
		t.anchors = /* @__PURE__ */ new Set();
		for (let e of n.anchors.keys()) t.anchors.add(e.anchor);
		t.inFlow = !0, t.inStringifyKey = !0;
		let r = e.toString(t);
		if (!n.mapKeyWarned) {
			let e = JSON.stringify(r);
			e.length > 40 && (e = e.substring(0, 36) + "...\""), sa(n.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${e}. Set mapAsMap: true to use object keys.`), n.mapKeyWarned = !0;
		}
		return r;
	}
	return JSON.stringify(t);
}
// node_modules/yaml/browser/dist/nodes/Pair.js
function ga(e, t, n) {
	return new J(Pi(e, void 0, n), Pi(t, void 0, n));
}
var J = class e {
	constructor(e, t = null) {
		Object.defineProperty(this, V, { value: ai }), this.key = e, this.value = t;
	}
	clone(t) {
		let { key: n, value: r } = this;
		return G(n) && (n = n.clone(t)), G(r) && (r = r.clone(t)), new e(n, r);
	}
	toJSON(e, t) {
		return ma(t, t?.mapAsMap ? /* @__PURE__ */ new Map() : {}, this);
	}
	toString(e, t, n) {
		return e?.doc ? oa(this, e, t, n) : JSON.stringify(this);
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyCollection.js
function _a(e, t, n) {
	return (t.inFlow ?? e.flow ? ya : va)(e, t, n);
}
function va({ comment: e, items: t }, n, { blockItemPrefix: r, flowChars: i, itemIndent: a, onChompKeep: o, onComment: s }) {
	let { indent: c, options: { commentString: l } } = n, u = Object.assign({}, n, {
		indent: a,
		type: null
	}), d = !1, f = [];
	for (let e = 0; e < t.length; ++e) {
		let i = t[e], o = null;
		if (G(i)) !d && i.spaceBefore && f.push(""), ba(n, f, i.commentBefore, d), i.comment && (o = i.comment);
		else if (H(i)) {
			let e = G(i.key) ? i.key : null;
			e && (!d && e.spaceBefore && f.push(""), ba(n, f, e.commentBefore, d));
		}
		d = !1;
		let s = aa(i, u, () => o = null, () => d = !0);
		o && (s += Bi(s, a, l(o))), d && o && (d = !1), f.push(r + s);
	}
	let p;
	if (f.length === 0) p = i.start + i.end;
	else {
		p = f[0];
		for (let e = 1; e < f.length; ++e) {
			let t = f[e];
			p += t ? `\n${c}${t}` : "\n";
		}
	}
	return e ? (p += "\n" + zi(l(e), c), s && s()) : d && o && o(), p;
}
function ya({ items: e }, t, { flowChars: n, itemIndent: r }) {
	let { indent: i, indentStep: a, flowCollectionPadding: o, options: { commentString: s } } = t;
	r += a;
	let c = Object.assign({}, t, {
		indent: r,
		inFlow: !0,
		type: null
	}), l = !1, u = 0, d = [];
	for (let n = 0; n < e.length; ++n) {
		let i = e[n], a = null;
		if (G(i)) i.spaceBefore && d.push(""), ba(t, d, i.commentBefore, !1), i.comment && (a = i.comment);
		else if (H(i)) {
			let e = G(i.key) ? i.key : null;
			e && (e.spaceBefore && d.push(""), ba(t, d, e.commentBefore, !1), e.comment && (l = !0));
			let n = G(i.value) ? i.value : null;
			n ? (n.comment && (a = n.comment), n.commentBefore && (l = !0)) : i.value == null && e?.comment && (a = e.comment);
		}
		a && (l = !0);
		let o = aa(i, c, () => a = null);
		l ||= d.length > u || o.includes("\n"), n < e.length - 1 ? o += "," : t.options.trailingComma && (t.options.lineWidth > 0 && (l ||= d.reduce((e, t) => e + t.length + 2, 2) + (o.length + 2) > t.options.lineWidth), l && (o += ",")), a && (o += Bi(o, r, s(a))), d.push(o), u = d.length;
	}
	let { start: f, end: p } = n;
	if (d.length === 0) return f + p;
	if (!l) {
		let e = d.reduce((e, t) => e + t.length + 2, 2);
		l = t.options.lineWidth > 0 && e > t.options.lineWidth;
	}
	if (l) {
		let e = f;
		for (let t of d) e += t ? `\n${a}${i}${t}` : "\n";
		return `${e}\n${i}${p}`;
	}
	return `${f}${o}${d.join(" ")}${o}${p}`;
}
function ba({ indent: e, options: { commentString: t } }, n, r, i) {
	if (r && i && (r = r.replace(/^\n+/, "")), r) {
		let i = zi(t(r), e);
		n.push(i.trimStart());
	}
}
// node_modules/yaml/browser/dist/nodes/YAMLMap.js
function xa(e, t) {
	let n = U(t) ? t.value : t;
	for (let r of e) if (H(r) && (r.key === t || r.key === n || U(r.key) && r.key.value === n)) return r;
}
var Y = class extends Li {
	static get tagName() {
		return "tag:yaml.org,2002:map";
	}
	constructor(e) {
		super(ii, e), this.items = [];
	}
	static from(e, t, n) {
		let { keepUndefined: r, replacer: i } = n, a = new this(e), o = (e, o) => {
			if (typeof i == "function") o = i.call(t, e, o);
			else if (Array.isArray(i) && !i.includes(e)) return;
			(o !== void 0 || r) && a.items.push(ga(e, o, n));
		};
		if (t instanceof Map) for (let [e, n] of t) o(e, n);
		else if (t && typeof t == "object") for (let e of Object.keys(t)) o(e, t[e]);
		return typeof e.sortMapEntries == "function" && a.items.sort(e.sortMapEntries), a;
	}
	add(e, t) {
		let n;
		n = H(e) ? e : !e || typeof e != "object" || !("key" in e) ? new J(e, e?.value) : new J(e.key, e.value);
		let r = xa(this.items, n.key), i = this.schema?.sortMapEntries;
		if (r) {
			if (!t) throw Error(`Key ${n.key} already set`);
			U(r.value) && ji(n.value) ? r.value.value = n.value : r.value = n.value;
		} else if (i) {
			let e = this.items.findIndex((e) => i(n, e) < 0);
			e === -1 ? this.items.push(n) : this.items.splice(e, 0, n);
		} else this.items.push(n);
	}
	delete(e) {
		let t = xa(this.items, e);
		return t ? this.items.splice(this.items.indexOf(t), 1).length > 0 : !1;
	}
	get(e, t) {
		let n = xa(this.items, e)?.value;
		return (!t && U(n) ? n.value : n) ?? void 0;
	}
	has(e) {
		return !!xa(this.items, e);
	}
	set(e, t) {
		this.add(new J(e, t), !0);
	}
	toJSON(e, t, n) {
		let r = n ? new n() : t?.mapAsMap ? /* @__PURE__ */ new Map() : {};
		t?.onCreate && t.onCreate(r);
		for (let e of this.items) ma(t, r, e);
		return r;
	}
	toString(e, t, n) {
		if (!e) return JSON.stringify(this);
		for (let e of this.items) if (!H(e)) throw Error(`Map items must all be pairs; found ${JSON.stringify(e)} instead`);
		return !e.allNullValues && this.hasAllNullValues(!1) && (e = Object.assign({}, e, { allNullValues: !0 })), _a(this, e, {
			blockItemPrefix: "",
			flowChars: {
				start: "{",
				end: "}"
			},
			itemIndent: e.indent || "",
			onChompKeep: n,
			onComment: t
		});
	}
}, Sa = {
	collection: "map",
	default: !0,
	nodeClass: Y,
	tag: "tag:yaml.org,2002:map",
	resolve(e, t) {
		return li(e) || t("Expected a mapping for this tag"), e;
	},
	createNode: (e, t, n) => Y.from(e, t, n)
}, Ca = class extends Li {
	static get tagName() {
		return "tag:yaml.org,2002:seq";
	}
	constructor(e) {
		super(oi, e), this.items = [];
	}
	add(e) {
		this.items.push(e);
	}
	delete(e) {
		let t = wa(e);
		return typeof t == "number" && this.items.splice(t, 1).length > 0;
	}
	get(e, t) {
		let n = wa(e);
		if (typeof n != "number") return;
		let r = this.items[n];
		return !t && U(r) ? r.value : r;
	}
	has(e) {
		let t = wa(e);
		return typeof t == "number" && t < this.items.length;
	}
	set(e, t) {
		let n = wa(e);
		if (typeof n != "number") throw Error(`Expected a valid index, not ${e}.`);
		let r = this.items[n];
		U(r) && ji(t) ? r.value = t : this.items[n] = t;
	}
	toJSON(e, t) {
		let n = [];
		t?.onCreate && t.onCreate(n);
		let r = 0;
		for (let e of this.items) n.push(K(e, String(r++), t));
		return n;
	}
	toString(e, t, n) {
		return e ? _a(this, e, {
			blockItemPrefix: "- ",
			flowChars: {
				start: "[",
				end: "]"
			},
			itemIndent: (e.indent || "") + "  ",
			onChompKeep: n,
			onComment: t
		}) : JSON.stringify(this);
	}
	static from(e, t, n) {
		let { replacer: r } = n, i = new this(e);
		if (t && Symbol.iterator in Object(t)) {
			let e = 0;
			for (let a of t) {
				if (typeof r == "function") {
					let n = t instanceof Set ? a : String(e++);
					a = r.call(t, n, a);
				}
				i.items.push(Pi(a, void 0, n));
			}
		}
		return i;
	}
};
function wa(e) {
	let t = U(e) ? e.value : e;
	return t && typeof t == "string" && (t = Number(t)), typeof t == "number" && Number.isInteger(t) && t >= 0 ? t : null;
}
// node_modules/yaml/browser/dist/schema/common/seq.js
var Ta = {
	collection: "seq",
	default: !0,
	nodeClass: Ca,
	tag: "tag:yaml.org,2002:seq",
	resolve(e, t) {
		return ui(e) || t("Expected a sequence for this tag"), e;
	},
	createNode: (e, t, n) => Ca.from(e, t, n)
}, Ea = {
	identify: (e) => typeof e == "string",
	default: !0,
	tag: "tag:yaml.org,2002:str",
	resolve: (e) => e,
	stringify(e, t, n, r) {
		return t = Object.assign({ actualString: !0 }, t), ta(e, t, n, r);
	}
}, Da = {
	identify: (e) => e == null,
	createNode: () => new q(null),
	default: !0,
	tag: "tag:yaml.org,2002:null",
	test: /^(?:~|[Nn]ull|NULL)?$/,
	resolve: () => new q(null),
	stringify: ({ source: e }, t) => typeof e == "string" && Da.test.test(e) ? e : t.options.nullStr
}, Oa = {
	identify: (e) => typeof e == "boolean",
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
	resolve: (e) => new q(e[0] === "t" || e[0] === "T"),
	stringify({ source: e, value: t }, n) {
		return e && Oa.test.test(e) && t === (e[0] === "t" || e[0] === "T") ? e : t ? n.options.trueStr : n.options.falseStr;
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyNumber.js
function X({ format: e, minFractionDigits: t, tag: n, value: r }) {
	if (typeof r == "bigint") return String(r);
	let i = typeof r == "number" ? r : Number(r);
	if (!isFinite(i)) return isNaN(i) ? ".nan" : i < 0 ? "-.inf" : ".inf";
	let a = Object.is(r, -0) ? "-0" : JSON.stringify(r);
	if (!e && t && (!n || n === "tag:yaml.org,2002:float") && /^-?\d/.test(a) && !a.includes("e")) {
		let e = a.indexOf(".");
		e < 0 && (e = a.length, a += ".");
		let n = t - (a.length - e - 1);
		for (; n-- > 0;) a += "0";
	}
	return a;
}
// node_modules/yaml/browser/dist/schema/core/float.js
var ka = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
	resolve: (e) => e.slice(-3).toLowerCase() === "nan" ? NaN : e[0] === "-" ? -Infinity : Infinity,
	stringify: X
}, Aa = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "EXP",
	test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
	resolve: (e) => parseFloat(e),
	stringify(e) {
		let t = Number(e.value);
		return isFinite(t) ? t.toExponential() : X(e);
	}
}, ja = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
	resolve(e) {
		let t = new q(parseFloat(e)), n = e.indexOf(".");
		return n !== -1 && e[e.length - 1] === "0" && (t.minFractionDigits = e.length - n - 1), t;
	},
	stringify: X
}, Ma = (e) => typeof e == "bigint" || Number.isInteger(e), Na = (e, t, n, { intAsBigInt: r }) => r ? BigInt(e) : parseInt(e.substring(t), n);
function Pa(e, t, n) {
	let { value: r } = e;
	return Ma(r) && r >= 0 ? n + r.toString(t) : X(e);
}
var Fa = {
	identify: (e) => Ma(e) && e >= 0,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "OCT",
	test: /^0o[0-7]+$/,
	resolve: (e, t, n) => Na(e, 2, 8, n),
	stringify: (e) => Pa(e, 8, "0o")
}, Ia = {
	identify: Ma,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	test: /^[-+]?[0-9]+$/,
	resolve: (e, t, n) => Na(e, 0, 10, n),
	stringify: X
}, La = {
	identify: (e) => Ma(e) && e >= 0,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "HEX",
	test: /^0x[0-9a-fA-F]+$/,
	resolve: (e, t, n) => Na(e, 2, 16, n),
	stringify: (e) => Pa(e, 16, "0x")
}, Ra = [
	Sa,
	Ta,
	Ea,
	Da,
	Oa,
	Fa,
	Ia,
	La,
	ka,
	Aa,
	ja
];
// node_modules/yaml/browser/dist/schema/json/schema.js
function za(e) {
	return typeof e == "bigint" || Number.isInteger(e);
}
var Ba = ({ value: e }) => JSON.stringify(e), Va = [
	{
		identify: (e) => typeof e == "string",
		default: !0,
		tag: "tag:yaml.org,2002:str",
		resolve: (e) => e,
		stringify: Ba
	},
	{
		identify: (e) => e == null,
		createNode: () => new q(null),
		default: !0,
		tag: "tag:yaml.org,2002:null",
		test: /^null$/,
		resolve: () => null,
		stringify: Ba
	},
	{
		identify: (e) => typeof e == "boolean",
		default: !0,
		tag: "tag:yaml.org,2002:bool",
		test: /^true$|^false$/,
		resolve: (e) => e === "true",
		stringify: Ba
	},
	{
		identify: za,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		test: /^-?(?:0|[1-9][0-9]*)$/,
		resolve: (e, t, { intAsBigInt: n }) => n ? BigInt(e) : parseInt(e, 10),
		stringify: ({ value: e }) => za(e) ? e.toString() : JSON.stringify(e)
	},
	{
		identify: (e) => typeof e == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
		resolve: (e) => parseFloat(e),
		stringify: Ba
	}
], Ha = [Sa, Ta].concat(Va, {
	default: !0,
	tag: "",
	test: /^/,
	resolve(e, t) {
		return t(`Unresolved plain scalar ${JSON.stringify(e)}`), e;
	}
}), Ua = {
	identify: (e) => e instanceof Uint8Array,
	default: !1,
	tag: "tag:yaml.org,2002:binary",
	resolve(e, t) {
		if (typeof atob == "function") {
			let t = atob(e.replace(/[\n\r]/g, "")), n = new Uint8Array(t.length);
			for (let e = 0; e < t.length; ++e) n[e] = t.charCodeAt(e);
			return n;
		}
		return t("This environment does not support reading binary tags; either Buffer or atob is required"), e;
	},
	stringify({ comment: e, type: t, value: n }, r, i, a) {
		if (!n) return "";
		let o = n, s;
		if (typeof btoa == "function") {
			let e = "";
			for (let t = 0; t < o.length; ++t) e += String.fromCharCode(o[t]);
			s = btoa(e);
		} else throw Error("This environment does not support writing binary tags; either Buffer or btoa is required");
		if (t ??= q.BLOCK_LITERAL, t !== q.QUOTE_DOUBLE) {
			let e = Math.max(r.options.lineWidth - r.indent.length, r.options.minContentWidth), n = Math.ceil(s.length / e), i = Array(n);
			for (let t = 0, r = 0; t < n; ++t, r += e) i[t] = s.substr(r, e);
			s = i.join(t === q.BLOCK_LITERAL ? "\n" : " ");
		}
		return ta({
			comment: e,
			type: t,
			value: s
		}, r, i, a);
	}
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/pairs.js
function Wa(e, t) {
	if (ui(e)) for (let n = 0; n < e.items.length; ++n) {
		let r = e.items[n];
		if (!H(r)) {
			if (li(r)) {
				r.items.length > 1 && t("Each pair must have its own sequence indicator");
				let e = r.items[0] || new J(new q(null));
				if (r.commentBefore && (e.key.commentBefore = e.key.commentBefore ? `${r.commentBefore}\n${e.key.commentBefore}` : r.commentBefore), r.comment) {
					let t = e.value ?? e.key;
					t.comment = t.comment ? `${r.comment}\n${t.comment}` : r.comment;
				}
				r = e;
			}
			e.items[n] = H(r) ? r : new J(r);
		}
	}
	else t("Expected a sequence for this tag");
	return e;
}
function Ga(e, t, n) {
	let { replacer: r } = n, i = new Ca(e);
	i.tag = "tag:yaml.org,2002:pairs";
	let a = 0;
	if (t && Symbol.iterator in Object(t)) for (let e of t) {
		typeof r == "function" && (e = r.call(t, String(a++), e));
		let o, s;
		if (Array.isArray(e)) {
			if (e.length === 2) o = e[0], s = e[1];
			else throw TypeError(`Expected [key, value] tuple: ${e}`);
		} else if (e && e instanceof Object) {
			let t = Object.keys(e);
			if (t.length === 1) o = t[0], s = e[o];
			else throw TypeError(`Expected tuple with one key, not ${t.length} keys`);
		} else o = e;
		i.items.push(ga(o, s, n));
	}
	return i;
}
var Ka = {
	collection: "seq",
	default: !1,
	tag: "tag:yaml.org,2002:pairs",
	resolve: Wa,
	createNode: Ga
}, qa = class e extends Ca {
	constructor() {
		super(), this.add = Y.prototype.add.bind(this), this.delete = Y.prototype.delete.bind(this), this.get = Y.prototype.get.bind(this), this.has = Y.prototype.has.bind(this), this.set = Y.prototype.set.bind(this), this.tag = e.tag;
	}
	toJSON(e, t) {
		if (!t) return super.toJSON(e);
		let n = /* @__PURE__ */ new Map();
		t?.onCreate && t.onCreate(n);
		for (let e of this.items) {
			let r, i;
			if (H(e) ? (r = K(e.key, "", t), i = K(e.value, r, t)) : r = K(e, "", t), n.has(r)) throw Error("Ordered maps must not include duplicate keys");
			n.set(r, i);
		}
		return n;
	}
	static from(e, t, n) {
		let r = Ga(e, t, n), i = new this();
		return i.items = r.items, i;
	}
};
qa.tag = "tag:yaml.org,2002:omap";
var Ja = {
	collection: "seq",
	identify: (e) => e instanceof Map,
	nodeClass: qa,
	default: !1,
	tag: "tag:yaml.org,2002:omap",
	resolve(e, t) {
		let n = Wa(e, t), r = [];
		for (let { key: e } of n.items) U(e) && (r.includes(e.value) ? t(`Ordered maps must not include duplicate keys: ${e.value}`) : r.push(e.value));
		return Object.assign(new qa(), n);
	},
	createNode: (e, t, n) => qa.from(e, t, n)
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/bool.js
function Ya({ value: e, source: t }, n) {
	return t && (e ? Xa : Za).test.test(t) ? t : e ? n.options.trueStr : n.options.falseStr;
}
var Xa = {
	identify: (e) => e === !0,
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
	resolve: () => new q(!0),
	stringify: Ya
}, Za = {
	identify: (e) => e === !1,
	default: !0,
	tag: "tag:yaml.org,2002:bool",
	test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
	resolve: () => new q(!1),
	stringify: Ya
}, Qa = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
	resolve: (e) => e.slice(-3).toLowerCase() === "nan" ? NaN : e[0] === "-" ? -Infinity : Infinity,
	stringify: X
}, $a = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "EXP",
	test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
	resolve: (e) => parseFloat(e.replace(/_/g, "")),
	stringify(e) {
		let t = Number(e.value);
		return isFinite(t) ? t.toExponential() : X(e);
	}
}, eo = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
	resolve(e) {
		let t = new q(parseFloat(e.replace(/_/g, ""))), n = e.indexOf(".");
		if (n !== -1) {
			let r = e.substring(n + 1).replace(/_/g, "");
			r[r.length - 1] === "0" && (t.minFractionDigits = r.length);
		}
		return t;
	},
	stringify: X
}, to = (e) => typeof e == "bigint" || Number.isInteger(e);
function no(e, t, n, { intAsBigInt: r }) {
	let i = e[0];
	if ((i === "-" || i === "+") && (t += 1), e = e.substring(t).replace(/_/g, ""), r) {
		switch (n) {
			case 2:
				e = `0b${e}`;
				break;
			case 8:
				e = `0o${e}`;
				break;
			case 16: e = `0x${e}`;
		}
		let t = BigInt(e);
		return i === "-" ? BigInt(-1) * t : t;
	}
	let a = parseInt(e, n);
	return i === "-" ? -1 * a : a;
}
function ro(e, t, n) {
	let { value: r } = e;
	if (to(r)) {
		let e = r.toString(t);
		return r < 0 ? "-" + n + e.substr(1) : n + e;
	}
	return X(e);
}
var io = {
	identify: to,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "BIN",
	test: /^[-+]?0b[0-1_]+$/,
	resolve: (e, t, n) => no(e, 2, 2, n),
	stringify: (e) => ro(e, 2, "0b")
}, ao = {
	identify: to,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "OCT",
	test: /^[-+]?0[0-7_]+$/,
	resolve: (e, t, n) => no(e, 1, 8, n),
	stringify: (e) => ro(e, 8, "0")
}, oo = {
	identify: to,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	test: /^[-+]?[0-9][0-9_]*$/,
	resolve: (e, t, n) => no(e, 0, 10, n),
	stringify: X
}, so = {
	identify: to,
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "HEX",
	test: /^[-+]?0x[0-9a-fA-F_]+$/,
	resolve: (e, t, n) => no(e, 2, 16, n),
	stringify: (e) => ro(e, 16, "0x")
}, co = class e extends Y {
	constructor(t) {
		super(t), this.tag = e.tag;
	}
	add(e) {
		let t;
		t = H(e) ? e : e && typeof e == "object" && "key" in e && "value" in e && e.value === null ? new J(e.key, null) : new J(e, null), xa(this.items, t.key) || this.items.push(t);
	}
	get(e, t) {
		let n = xa(this.items, e);
		return !t && H(n) ? U(n.key) ? n.key.value : n.key : n;
	}
	set(e, t) {
		if (typeof t != "boolean") throw Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof t}`);
		let n = xa(this.items, e);
		n && !t ? this.items.splice(this.items.indexOf(n), 1) : !n && t && this.items.push(new J(e));
	}
	toJSON(e, t) {
		return super.toJSON(e, t, Set);
	}
	toString(e, t, n) {
		if (!e) return JSON.stringify(this);
		if (this.hasAllNullValues(!0)) return super.toString(Object.assign({}, e, { allNullValues: !0 }), t, n);
		throw Error("Set items must all have null values");
	}
	static from(e, t, n) {
		let { replacer: r } = n, i = new this(e);
		if (t && Symbol.iterator in Object(t)) for (let e of t) typeof r == "function" && (e = r.call(t, e, e)), i.items.push(ga(e, null, n));
		return i;
	}
};
co.tag = "tag:yaml.org,2002:set";
var lo = {
	collection: "map",
	identify: (e) => e instanceof Set,
	nodeClass: co,
	default: !1,
	tag: "tag:yaml.org,2002:set",
	createNode: (e, t, n) => co.from(e, t, n),
	resolve(e, t) {
		if (li(e)) {
			if (e.hasAllNullValues(!0)) return Object.assign(new co(), e);
			t("Set items must all have null values");
		} else t("Expected a mapping for this tag");
		return e;
	}
};
// node_modules/yaml/browser/dist/schema/yaml-1.1/timestamp.js
function uo(e, t) {
	let n = e[0], r = n === "-" || n === "+" ? e.substring(1) : e, i = (e) => t ? BigInt(e) : Number(e), a = r.replace(/_/g, "").split(":").reduce((e, t) => e * i(60) + i(t), i(0));
	return n === "-" ? i(-1) * a : a;
}
function fo(e) {
	let { value: t } = e, n = (e) => e;
	if (typeof t == "bigint") n = (e) => BigInt(e);
	else if (isNaN(t) || !isFinite(t)) return X(e);
	let r = "";
	t < 0 && (r = "-", t *= n(-1));
	let i = n(60), a = [t % i];
	return t < 60 ? a.unshift(0) : (t = (t - a[0]) / i, a.unshift(t % i), t >= 60 && (t = (t - a[0]) / i, a.unshift(t))), r + a.map((e) => String(e).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
}
var po = {
	identify: (e) => typeof e == "bigint" || Number.isInteger(e),
	default: !0,
	tag: "tag:yaml.org,2002:int",
	format: "TIME",
	test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
	resolve: (e, t, { intAsBigInt: n }) => uo(e, n),
	stringify: fo
}, mo = {
	identify: (e) => typeof e == "number",
	default: !0,
	tag: "tag:yaml.org,2002:float",
	format: "TIME",
	test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
	resolve: (e) => uo(e, !1),
	stringify: fo
}, ho = {
	identify: (e) => e instanceof Date,
	default: !0,
	tag: "tag:yaml.org,2002:timestamp",
	test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
	resolve(e) {
		let t = e.match(ho.test);
		if (!t) throw Error("!!timestamp expects a date, starting with yyyy-mm-dd");
		let [, n, r, i, a, o, s] = t.map(Number), c = t[7] ? Number((t[7] + "00").substr(1, 3)) : 0, l = Date.UTC(n, r - 1, i, a || 0, o || 0, s || 0, c), u = t[8];
		if (u && u !== "Z") {
			let e = uo(u, !1);
			Math.abs(e) < 30 && (e *= 60), l -= 6e4 * e;
		}
		return new Date(l);
	},
	stringify: ({ value: e }) => e?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
}, go = [
	Sa,
	Ta,
	Ea,
	Da,
	Xa,
	Za,
	io,
	ao,
	oo,
	so,
	Qa,
	$a,
	eo,
	Ua,
	la,
	Ja,
	Ka,
	lo,
	po,
	mo,
	ho
], _o = /* @__PURE__ */ new Map([
	["core", Ra],
	["failsafe", [
		Sa,
		Ta,
		Ea
	]],
	["json", Ha],
	["yaml11", go],
	["yaml-1.1", go]
]), vo = {
	binary: Ua,
	bool: Oa,
	float: ja,
	floatExp: Aa,
	floatNaN: ka,
	floatTime: mo,
	int: Ia,
	intHex: La,
	intOct: Fa,
	intTime: po,
	map: Sa,
	merge: la,
	null: Da,
	omap: Ja,
	pairs: Ka,
	seq: Ta,
	set: lo,
	timestamp: ho
}, yo = {
	"tag:yaml.org,2002:binary": Ua,
	"tag:yaml.org,2002:merge": la,
	"tag:yaml.org,2002:omap": Ja,
	"tag:yaml.org,2002:pairs": Ka,
	"tag:yaml.org,2002:set": lo,
	"tag:yaml.org,2002:timestamp": ho
};
function bo(e, t, n) {
	let r = _o.get(t);
	if (r && !e) return n && !r.includes(la) ? r.concat(la) : r.slice();
	let i = r;
	if (!i) {
		if (Array.isArray(e)) i = [];
		else {
			let e = Array.from(_o.keys()).filter((e) => e !== "yaml11").map((e) => JSON.stringify(e)).join(", ");
			throw Error(`Unknown schema "${t}"; use one of ${e} or define customTags array`);
		}
	}
	if (Array.isArray(e)) for (let t of e) i = i.concat(t);
	else typeof e == "function" && (i = e(i.slice()));
	return n && (i = i.concat(la)), i.reduce((e, t) => {
		let n = typeof t == "string" ? vo[t] : t;
		if (!n) {
			let e = JSON.stringify(t), n = Object.keys(vo).map((e) => JSON.stringify(e)).join(", ");
			throw Error(`Unknown custom tag ${e}; use one of ${n}`);
		}
		return e.includes(n) || e.push(n), e;
	}, []);
}
// node_modules/yaml/browser/dist/schema/Schema.js
var xo = (e, t) => e.key < t.key ? -1 : +(e.key > t.key), So = class e {
	constructor({ compat: e, customTags: t, merge: n, resolveKnownTags: r, schema: i, sortMapEntries: a, toStringDefaults: o }) {
		this.compat = Array.isArray(e) ? bo(e, "compat") : e ? bo(null, e) : null, this.name = typeof i == "string" && i || "core", this.knownTags = r ? yo : {}, this.tags = bo(t, this.name, n), this.toStringOptions = o ?? null, Object.defineProperty(this, ii, { value: Sa }), Object.defineProperty(this, B, { value: Ea }), Object.defineProperty(this, oi, { value: Ta }), this.sortMapEntries = typeof a == "function" ? a : a === !0 ? xo : null;
	}
	clone() {
		let t = Object.create(e.prototype, Object.getOwnPropertyDescriptors(this));
		return t.tags = this.tags.slice(), t;
	}
};
// node_modules/yaml/browser/dist/stringify/stringifyDocument.js
function Co(e, t) {
	let n = [], r = t.directives === !0;
	if (t.directives !== !1 && e.directives) {
		let t = e.directives.toString(e);
		t ? (n.push(t), r = !0) : e.directives.docStart && (r = !0);
	}
	r && n.push("---");
	let i = na(e, t), { commentString: a } = i.options;
	if (e.commentBefore) {
		n.length !== 1 && n.unshift("");
		let t = a(e.commentBefore);
		n.unshift(zi(t, ""));
	}
	let o = !1, s = null;
	if (e.contents) {
		if (G(e.contents)) {
			if (e.contents.spaceBefore && r && n.push(""), e.contents.commentBefore) {
				let t = a(e.contents.commentBefore);
				n.push(zi(t, ""));
			}
			i.forceBlockIndent = !!e.comment, s = e.contents.comment;
		}
		let t = s ? void 0 : () => o = !0, c = aa(e.contents, i, () => s = null, t);
		s && (c += Bi(c, "", a(s))), (c[0] === "|" || c[0] === ">") && n[n.length - 1] === "---" ? n[n.length - 1] = `--- ${c}` : n.push(c);
	} else n.push(aa(e.contents, i));
	if (e.directives?.docEnd) {
		if (e.comment) {
			let t = a(e.comment);
			t.includes("\n") ? (n.push("..."), n.push(zi(t, ""))) : n.push(`... ${t}`);
		} else n.push("...");
	} else {
		let t = e.comment;
		t && o && (t = t.replace(/^\n+/, "")), t && ((!o || s) && n[n.length - 1] !== "" && n.push(""), n.push(zi(a(t), "")));
	}
	return n.join("\n") + "\n";
}
// node_modules/yaml/browser/dist/doc/Document.js
var wo = class e {
	constructor(e, t, n) {
		this.commentBefore = null, this.comment = null, this.errors = [], this.warnings = [], Object.defineProperty(this, V, { value: ri });
		let r = null;
		typeof t == "function" || Array.isArray(t) ? r = t : n === void 0 && t && (n = t, t = void 0);
		let i = Object.assign({
			intAsBigInt: !1,
			keepSourceTokens: !1,
			logLevel: "warn",
			prettyErrors: !0,
			strict: !0,
			stringKeys: !1,
			uniqueKeys: !0,
			version: "1.2"
		}, n);
		this.options = i;
		let { version: a } = i;
		n?._directives ? (this.directives = n._directives.atDocument(), this.directives.yaml.explicit && (a = this.directives.yaml.version)) : this.directives = new Si({ version: a }), this.setSchema(a, n), this.contents = e === void 0 ? null : this.createNode(e, r, n);
	}
	clone() {
		let t = Object.create(e.prototype, { [V]: { value: ri } });
		return t.commentBefore = this.commentBefore, t.comment = this.comment, t.errors = this.errors.slice(), t.warnings = this.warnings.slice(), t.options = Object.assign({}, this.options), this.directives && (t.directives = this.directives.clone()), t.schema = this.schema.clone(), t.contents = G(this.contents) ? this.contents.clone(t.schema) : this.contents, this.range && (t.range = this.range.slice()), t;
	}
	add(e) {
		To(this.contents) && this.contents.add(e);
	}
	addIn(e, t) {
		To(this.contents) && this.contents.addIn(e, t);
	}
	createAlias(e, t) {
		if (!e.anchor) {
			let n = wi(this);
			e.anchor = !t || n.has(t) ? Ti(t || "a", n) : t;
		}
		return new ki(e.anchor);
	}
	createNode(e, t, n) {
		let r;
		if (typeof t == "function") e = t.call({ "": e }, "", e), r = t;
		else if (Array.isArray(t)) {
			let e = t.filter((e) => typeof e == "number" || e instanceof String || e instanceof Number).map(String);
			e.length > 0 && (t = t.concat(e)), r = t;
		} else n === void 0 && t && (n = t, t = void 0);
		let { aliasDuplicateObjects: i, anchorPrefix: a, flow: o, keepUndefined: s, onTagObj: c, tag: l } = n ?? {}, { onAnchor: u, setAnchors: d, sourceObjects: f } = Ei(this, a || "a"), p = {
			aliasDuplicateObjects: i ?? !0,
			keepUndefined: s ?? !1,
			onAnchor: u,
			onTagObj: c,
			replacer: r,
			schema: this.schema,
			sourceObjects: f
		}, m = Pi(e, l, p);
		return o && W(m) && (m.flow = !0), d(), m;
	}
	createPair(e, t, n = {}) {
		return new J(this.createNode(e, null, n), this.createNode(t, null, n));
	}
	delete(e) {
		return To(this.contents) ? this.contents.delete(e) : !1;
	}
	deleteIn(e) {
		return Ii(e) ? this.contents != null && (this.contents = null, !0) : To(this.contents) ? this.contents.deleteIn(e) : !1;
	}
	get(e, t) {
		return W(this.contents) ? this.contents.get(e, t) : void 0;
	}
	getIn(e, t) {
		return Ii(e) ? !t && U(this.contents) ? this.contents.value : this.contents : W(this.contents) ? this.contents.getIn(e, t) : void 0;
	}
	has(e) {
		return W(this.contents) ? this.contents.has(e) : !1;
	}
	hasIn(e) {
		return Ii(e) ? this.contents !== void 0 : W(this.contents) ? this.contents.hasIn(e) : !1;
	}
	set(e, t) {
		this.contents == null ? this.contents = Fi(this.schema, [e], t) : To(this.contents) && this.contents.set(e, t);
	}
	setIn(e, t) {
		Ii(e) ? this.contents = t : this.contents == null ? this.contents = Fi(this.schema, Array.from(e), t) : To(this.contents) && this.contents.setIn(e, t);
	}
	setSchema(e, t = {}) {
		typeof e == "number" && (e = String(e));
		let n;
		switch (e) {
			case "1.1":
				this.directives ? this.directives.yaml.version = "1.1" : this.directives = new Si({ version: "1.1" }), n = {
					resolveKnownTags: !1,
					schema: "yaml-1.1"
				};
				break;
			case "1.2":
			case "next":
				this.directives ? this.directives.yaml.version = e : this.directives = new Si({ version: e }), n = {
					resolveKnownTags: !0,
					schema: "core"
				};
				break;
			case null:
				this.directives && delete this.directives, n = null;
				break;
			default: {
				let t = JSON.stringify(e);
				throw Error(`Expected '1.1', '1.2' or null as first argument, but found: ${t}`);
			}
		}
		if (t.schema instanceof Object) this.schema = t.schema;
		else if (n) this.schema = new So(Object.assign(n, t));
		else throw Error("With a null YAML version, the { schema: Schema } option is required");
	}
	toJS({ json: e, jsonArg: t, mapAsMap: n, maxAliasCount: r, onAnchor: i, reviver: a } = {}) {
		let o = {
			anchors: /* @__PURE__ */ new Map(),
			doc: this,
			keep: !e,
			mapAsMap: n === !0,
			mapKeyWarned: !1,
			maxAliasCount: typeof r == "number" ? r : 100
		}, s = K(this.contents, t ?? "", o);
		if (typeof i == "function") for (let { count: e, res: t } of o.anchors.values()) i(t, e);
		return typeof a == "function" ? Di(a, { "": s }, "", s) : s;
	}
	toJSON(e, t) {
		return this.toJS({
			json: !0,
			jsonArg: e,
			mapAsMap: !1,
			onAnchor: t
		});
	}
	toString(e = {}) {
		if (this.errors.length > 0) throw Error("Document with errors cannot be stringified");
		if ("indent" in e && (!Number.isInteger(e.indent) || Number(e.indent) <= 0)) {
			let t = JSON.stringify(e.indent);
			throw Error(`"indent" option must be a positive integer, not ${t}`);
		}
		return Co(this, e);
	}
};
function To(e) {
	if (W(e)) return !0;
	throw Error("Expected a YAML collection as document contents");
}
// node_modules/yaml/browser/dist/errors.js
var Eo = class extends Error {
	constructor(e, t, n, r) {
		super(), this.name = e, this.code = n, this.message = r, this.pos = t;
	}
}, Do = class extends Eo {
	constructor(e, t, n) {
		super("YAMLParseError", e, t, n);
	}
}, Oo = class extends Eo {
	constructor(e, t, n) {
		super("YAMLWarning", e, t, n);
	}
}, ko = (e, t) => (n) => {
	if (n.pos[0] === -1) return;
	n.linePos = n.pos.map((e) => t.linePos(e));
	let { line: r, col: i } = n.linePos[0];
	n.message += ` at line ${r}, column ${i}`;
	let a = i - 1, o = e.substring(t.lineStarts[r - 1], t.lineStarts[r]).replace(/[\n\r]+$/, "");
	if (a >= 60 && o.length > 80) {
		let e = Math.min(a - 39, o.length - 79);
		o = "…" + o.substring(e), a -= e - 1;
	}
	if (o.length > 80 && (o = o.substring(0, 79) + "…"), r > 1 && /^ *$/.test(o.substring(0, a))) {
		let n = e.substring(t.lineStarts[r - 2], t.lineStarts[r - 1]);
		n.length > 80 && (n = n.substring(0, 79) + "…\n"), o = n + o;
	}
	if (/[^ ]/.test(o)) {
		let e = 1, t = n.linePos[1];
		t?.line === r && t.col > i && (e = Math.max(1, Math.min(t.col - i, 80 - a)));
		let s = " ".repeat(a) + "^".repeat(e);
		n.message += `:\n\n${o}\n${s}\n`;
	}
};
// node_modules/yaml/browser/dist/compose/resolve-props.js
function Ao(e, { flow: t, indicator: n, next: r, offset: i, onError: a, parentIndent: o, startOnNewline: s }) {
	let c = !1, l = s, u = s, d = "", f = "", p = !1, m = !1, h = null, g = null, _ = null, v = null, y = null, b = null, x = null;
	for (let i of e) switch (m &&= (i.type !== "space" && i.type !== "newline" && i.type !== "comma" && a(i.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space"), !1), h &&= (l && i.type !== "comment" && i.type !== "newline" && a(h, "TAB_AS_INDENT", "Tabs are not allowed as indentation"), null), i.type) {
		case "space":
			!t && (n !== "doc-start" || r?.type !== "flow-collection") && i.source.includes("	") && (h = i), u = !0;
			break;
		case "comment": {
			u || a(i, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
			let e = i.source.substring(1) || " ";
			d ? d += f + e : d = e, f = "", l = !1;
			break;
		}
		case "newline":
			l ? d ? d += i.source : b && n === "seq-item-ind" || (c = !0) : f += i.source, l = !0, p = !0, (g || _) && (v = i), u = !0;
			break;
		case "anchor":
			g && a(i, "MULTIPLE_ANCHORS", "A node can have at most one anchor"), i.source.endsWith(":") && a(i.offset + i.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", !0), g = i, x ??= i.offset, l = !1, u = !1, m = !0;
			break;
		case "tag":
			_ && a(i, "MULTIPLE_TAGS", "A node can have at most one tag"), _ = i, x ??= i.offset, l = !1, u = !1, m = !0;
			break;
		case n:
			(g || _) && a(i, "BAD_PROP_ORDER", `Anchors and tags must be after the ${i.source} indicator`), b && a(i, "UNEXPECTED_TOKEN", `Unexpected ${i.source} in ${t ?? "collection"}`), b = i, l = n === "seq-item-ind" || n === "explicit-key-ind", u = !1;
			break;
		case "comma": if (t) {
			y && a(i, "UNEXPECTED_TOKEN", `Unexpected , in ${t}`), y = i, l = !1, u = !1;
			break;
		}
		default: a(i, "UNEXPECTED_TOKEN", `Unexpected ${i.type} token`), l = !1, u = !1;
	}
	let S = e[e.length - 1], ee = S ? S.offset + S.source.length : i;
	return m && r && r.type !== "space" && r.type !== "newline" && r.type !== "comma" && (r.type !== "scalar" || r.source !== "") && a(r.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space"), h && (l && h.indent <= o || r?.type === "block-map" || r?.type === "block-seq") && a(h, "TAB_AS_INDENT", "Tabs are not allowed as indentation"), {
		comma: y,
		found: b,
		spaceBefore: c,
		comment: d,
		hasNewline: p,
		anchor: g,
		tag: _,
		newlineAfterProp: v,
		end: ee,
		start: x ?? ee
	};
}
// node_modules/yaml/browser/dist/compose/util-contains-newline.js
function jo(e) {
	if (!e) return null;
	switch (e.type) {
		case "alias":
		case "scalar":
		case "double-quoted-scalar":
		case "single-quoted-scalar":
			if (e.source.includes("\n")) return !0;
			if (e.end) {
				for (let t of e.end) if (t.type === "newline") return !0;
			}
			return !1;
		case "flow-collection":
			for (let t of e.items) {
				for (let e of t.start) if (e.type === "newline") return !0;
				if (t.sep) {
					for (let e of t.sep) if (e.type === "newline") return !0;
				}
				if (jo(t.key) || jo(t.value)) return !0;
			}
			return !1;
		default: return !0;
	}
}
// node_modules/yaml/browser/dist/compose/util-flow-indent-check.js
function Mo(e, t, n) {
	if (t?.type === "flow-collection") {
		let r = t.end[0];
		r.indent === e && (r.source === "]" || r.source === "}") && jo(t) && n(r, "BAD_INDENT", "Flow end indicator should be more indented than parent", !0);
	}
}
// node_modules/yaml/browser/dist/compose/util-map-includes.js
function No(e, t, n) {
	let { uniqueKeys: r } = e.options;
	if (r === !1) return !1;
	let i = typeof r == "function" ? r : (e, t) => e === t || U(e) && U(t) && e.value === t.value;
	return t.some((e) => i(e.key, n));
}
// node_modules/yaml/browser/dist/compose/resolve-block-map.js
var Po = "All mapping items must start at the same column";
function Fo({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = new ((a?.nodeClass) ?? Y)(n.schema);
	n.atRoot &&= !1;
	let s = r.offset, c = null;
	for (let a of r.items) {
		let { start: l, key: u, sep: d, value: f } = a, p = Ao(l, {
			indicator: "explicit-key-ind",
			next: u ?? d?.[0],
			offset: s,
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !0
		}), m = !p.found;
		if (m) {
			if (u && (u.type === "block-seq" ? i(s, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key") : "indent" in u && u.indent !== r.indent && i(s, "BAD_INDENT", Po)), !p.anchor && !p.tag && !d) {
				c = p.end, p.comment && (o.comment ? o.comment += "\n" + p.comment : o.comment = p.comment);
				continue;
			}
			(p.newlineAfterProp || jo(u)) && i(u ?? l[l.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
		} else p.found?.indent !== r.indent && i(s, "BAD_INDENT", Po);
		n.atKey = !0;
		let h = p.end, g = u ? e(n, u, p, i) : t(n, h, l, null, p, i);
		n.schema.compat && Mo(r.indent, u, i), n.atKey = !1, No(n, o.items, g) && i(h, "DUPLICATE_KEY", "Map keys must be unique");
		let _ = Ao(d ?? [], {
			indicator: "map-value-ind",
			next: f,
			offset: g.range[2],
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !u || u.type === "block-scalar"
		});
		if (s = _.end, _.found) {
			m && (f?.type === "block-map" && !_.hasNewline && i(s, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings"), n.options.strict && p.start < _.found.offset - 1024 && i(g.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key"));
			let c = f ? e(n, f, _, i) : t(n, s, d, null, _, i);
			n.schema.compat && Mo(r.indent, f, i), s = c.range[2];
			let l = new J(g, c);
			n.options.keepSourceTokens && (l.srcToken = a), o.items.push(l);
		} else {
			m && i(g.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values"), _.comment && (g.comment ? g.comment += "\n" + _.comment : g.comment = _.comment);
			let e = new J(g);
			n.options.keepSourceTokens && (e.srcToken = a), o.items.push(e);
		}
	}
	return c && c < s && i(c, "IMPOSSIBLE", "Map comment with trailing content"), o.range = [
		r.offset,
		s,
		c ?? s
	], o;
}
// node_modules/yaml/browser/dist/compose/resolve-block-seq.js
function Io({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = new ((a?.nodeClass) ?? Ca)(n.schema);
	n.atRoot &&= !1, n.atKey &&= !1;
	let s = r.offset, c = null;
	for (let { start: a, value: l } of r.items) {
		let u = Ao(a, {
			indicator: "seq-item-ind",
			next: l,
			offset: s,
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !0
		});
		if (!u.found) {
			if (u.anchor || u.tag || l) l?.type === "block-seq" ? i(u.end, "BAD_INDENT", "All sequence items must start at the same column") : i(s, "MISSING_CHAR", "Sequence item without - indicator");
			else {
				c = u.end, u.comment && (o.comment = u.comment);
				continue;
			}
		}
		let d = l ? e(n, l, u, i) : t(n, u.end, a, null, u, i);
		n.schema.compat && Mo(r.indent, l, i), s = d.range[2], o.items.push(d);
	}
	return o.range = [
		r.offset,
		s,
		c ?? s
	], o;
}
// node_modules/yaml/browser/dist/compose/resolve-end.js
function Lo(e, t, n, r) {
	let i = "";
	if (e) {
		let a = !1, o = "";
		for (let s of e) {
			let { source: e, type: c } = s;
			switch (c) {
				case "space":
					a = !0;
					break;
				case "comment": {
					n && !a && r(s, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
					let t = e.substring(1) || " ";
					i ? i += o + t : i = t, o = "";
					break;
				}
				case "newline":
					i && (o += e), a = !0;
					break;
				default: r(s, "UNEXPECTED_TOKEN", `Unexpected ${c} at node end`);
			}
			t += e.length;
		}
	}
	return {
		comment: i,
		offset: t
	};
}
// node_modules/yaml/browser/dist/compose/resolve-flow-collection.js
var Ro = "Block collections are not allowed within flow collections", zo = (e) => e && (e.type === "block-map" || e.type === "block-seq");
function Bo({ composeNode: e, composeEmptyNode: t }, n, r, i, a) {
	let o = r.start.source === "{", s = o ? "flow map" : "flow sequence", c = new ((a?.nodeClass) ?? (o ? Y : Ca))(n.schema);
	c.flow = !0;
	let l = n.atRoot;
	l && (n.atRoot = !1), n.atKey &&= !1;
	let u = r.offset + r.start.source.length;
	for (let a = 0; a < r.items.length; ++a) {
		let l = r.items[a], { start: d, key: f, sep: p, value: m } = l, h = Ao(d, {
			flow: s,
			indicator: "explicit-key-ind",
			next: f ?? p?.[0],
			offset: u,
			onError: i,
			parentIndent: r.indent,
			startOnNewline: !1
		});
		if (!h.found) {
			if (!h.anchor && !h.tag && !p && !m) {
				a === 0 && h.comma ? i(h.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${s}`) : a < r.items.length - 1 && i(h.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${s}`), h.comment && (c.comment ? c.comment += "\n" + h.comment : c.comment = h.comment), u = h.end;
				continue;
			}
			!o && n.options.strict && jo(f) && i(f, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
		}
		if (a === 0) h.comma && i(h.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${s}`);
		else if (h.comma || i(h.start, "MISSING_CHAR", `Missing , between ${s} items`), h.comment) {
			let e = "";
			loop: for (let t of d) switch (t.type) {
				case "comma":
				case "space": break;
				case "comment":
					e = t.source.substring(1);
					break loop;
				default: break loop;
			}
			if (e) {
				let t = c.items[c.items.length - 1];
				H(t) && (t = t.value ?? t.key), t.comment ? t.comment += "\n" + e : t.comment = e, h.comment = h.comment.substring(e.length + 1);
			}
		}
		if (!o && !p && !h.found) {
			let r = m ? e(n, m, h, i) : t(n, h.end, p, null, h, i);
			c.items.push(r), u = r.range[2], zo(m) && i(r.range, "BLOCK_IN_FLOW", Ro);
		} else {
			n.atKey = !0;
			let a = h.end, g = f ? e(n, f, h, i) : t(n, a, d, null, h, i);
			zo(f) && i(g.range, "BLOCK_IN_FLOW", Ro), n.atKey = !1;
			let _ = Ao(p ?? [], {
				flow: s,
				indicator: "map-value-ind",
				next: m,
				offset: g.range[2],
				onError: i,
				parentIndent: r.indent,
				startOnNewline: !1
			});
			if (_.found) {
				if (!o && !h.found && n.options.strict) {
					if (p) for (let e of p) {
						if (e === _.found) break;
						if (e.type === "newline") {
							i(e, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
							break;
						}
					}
					h.start < _.found.offset - 1024 && i(_.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
				}
			} else m && ("source" in m && m.source?.[0] === ":" ? i(m, "MISSING_CHAR", `Missing space after : in ${s}`) : i(_.start, "MISSING_CHAR", `Missing , or : between ${s} items`));
			let v = m ? e(n, m, _, i) : _.found ? t(n, _.end, p, null, _, i) : null;
			v ? zo(m) && i(v.range, "BLOCK_IN_FLOW", Ro) : _.comment && (g.comment ? g.comment += "\n" + _.comment : g.comment = _.comment);
			let y = new J(g, v);
			if (n.options.keepSourceTokens && (y.srcToken = l), o) {
				let e = c;
				No(n, e.items, g) && i(a, "DUPLICATE_KEY", "Map keys must be unique"), e.items.push(y);
			} else {
				let e = new Y(n.schema);
				e.flow = !0, e.items.push(y);
				let t = (v ?? g).range;
				e.range = [
					g.range[0],
					t[1],
					t[2]
				], c.items.push(e);
			}
			u = v ? v.range[2] : _.end;
		}
	}
	let d = o ? "}" : "]", [f, ...p] = r.end, m = u;
	if (f?.source === d) m = f.offset + f.source.length;
	else {
		let e = s[0].toUpperCase() + s.substring(1), t = l ? `${e} must end with a ${d}` : `${e} in block collection must be sufficiently indented and end with a ${d}`;
		i(u, l ? "MISSING_CHAR" : "BAD_INDENT", t), f && f.source.length !== 1 && p.unshift(f);
	}
	if (p.length > 0) {
		let e = Lo(p, m, n.options.strict, i);
		e.comment && (c.comment ? c.comment += "\n" + e.comment : c.comment = e.comment), c.range = [
			r.offset,
			m,
			e.offset
		];
	} else c.range = [
		r.offset,
		m,
		m
	];
	return c;
}
// node_modules/yaml/browser/dist/compose/compose-collection.js
function Vo(e, t, n, r, i, a) {
	let o = n.type === "block-map" ? Fo(e, t, n, r, a) : n.type === "block-seq" ? Io(e, t, n, r, a) : Bo(e, t, n, r, a), s = o.constructor;
	return i === "!" || i === s.tagName ? (o.tag = s.tagName, o) : (i && (o.tag = i), o);
}
function Ho(e, t, n, r, i) {
	let a = r.tag, o = a ? t.directives.tagName(a.source, (e) => i(a, "TAG_RESOLVE_FAILED", e)) : null;
	if (n.type === "block-seq") {
		let { anchor: e, newlineAfterProp: t } = r, n = e && a ? e.offset > a.offset ? e : a : e ?? a;
		n && (!t || t.offset < n.offset) && i(n, "MISSING_CHAR", "Missing newline after block sequence props");
	}
	let s = n.type === "block-map" ? "map" : n.type === "block-seq" ? "seq" : n.start.source === "{" ? "map" : "seq";
	if (!a || !o || o === "!" || o === Y.tagName && s === "map" || o === Ca.tagName && s === "seq") return Vo(e, t, n, i, o);
	let c = t.schema.tags.find((e) => e.tag === o && e.collection === s);
	if (!c) {
		let r = t.schema.knownTags[o];
		if (r?.collection === s) t.schema.tags.push(Object.assign({}, r, { default: !1 })), c = r;
		else return r ? i(a, "BAD_COLLECTION_TYPE", `${r.tag} used for ${s} collection, but expects ${r.collection ?? "scalar"}`, !0) : i(a, "TAG_RESOLVE_FAILED", `Unresolved tag: ${o}`, !0), Vo(e, t, n, i, o);
	}
	let l = Vo(e, t, n, i, o, c), u = c.resolve?.(l, (e) => i(a, "TAG_RESOLVE_FAILED", e), t.options) ?? l, d = G(u) ? u : new q(u);
	return d.range = l.range, d.tag = o, c?.format && (d.format = c.format), d;
}
// node_modules/yaml/browser/dist/compose/resolve-block-scalar.js
function Uo(e, t, n) {
	let r = t.offset, i = Wo(t, e.options.strict, n);
	if (!i) return {
		value: "",
		type: null,
		comment: "",
		range: [
			r,
			r,
			r
		]
	};
	let a = i.mode === ">" ? q.BLOCK_FOLDED : q.BLOCK_LITERAL, o = t.source ? Go(t.source) : [], s = o.length;
	for (let e = o.length - 1; e >= 0; --e) {
		let t = o[e][1];
		if (t === "" || t === "\r") s = e;
		else break;
	}
	if (s === 0) {
		let e = i.chomp === "+" && o.length > 0 ? "\n".repeat(Math.max(1, o.length - 1)) : "", n = r + i.length;
		return t.source && (n += t.source.length), {
			value: e,
			type: a,
			comment: i.comment,
			range: [
				r,
				n,
				n
			]
		};
	}
	let c = t.indent + i.indent, l = t.offset + i.length, u = 0;
	for (let t = 0; t < s; ++t) {
		let [r, a] = o[t];
		if (a === "" || a === "\r") i.indent === 0 && r.length > c && (c = r.length);
		else {
			r.length < c && n(l + r.length, "MISSING_CHAR", "Block scalars with more-indented leading empty lines must use an explicit indentation indicator"), i.indent === 0 && (c = r.length), u = t, c === 0 && !e.atRoot && n(l, "BAD_INDENT", "Block scalar values in collections must be indented");
			break;
		}
		l += r.length + a.length + 1;
	}
	for (let e = o.length - 1; e >= s; --e) o[e][0].length > c && (s = e + 1);
	let d = "", f = "", p = !1;
	for (let e = 0; e < u; ++e) d += o[e][0].slice(c) + "\n";
	for (let e = u; e < s; ++e) {
		let [t, r] = o[e];
		l += t.length + r.length + 1;
		let s = r[r.length - 1] === "\r";
		/* istanbul ignore if already caught in lexer */
		if (s && (r = r.slice(0, -1)), r && t.length < c) {
			let e = `Block scalar lines must not be less indented than their ${i.indent ? "explicit indentation indicator" : "first line"}`;
			n(l - r.length - (s ? 2 : 1), "BAD_INDENT", e), t = "";
		}
		a === q.BLOCK_LITERAL ? (d += f + t.slice(c) + r, f = "\n") : t.length > c || r[0] === "	" ? (f === " " ? f = "\n" : !p && f === "\n" && (f = "\n\n"), d += f + t.slice(c) + r, f = "\n", p = !0) : r === "" ? f === "\n" ? d += "\n" : f = "\n" : (d += f + r, f = " ", p = !1);
	}
	switch (i.chomp) {
		case "-": break;
		case "+":
			for (let e = s; e < o.length; ++e) d += "\n" + o[e][0].slice(c);
			d[d.length - 1] !== "\n" && (d += "\n");
			break;
		default: d += "\n";
	}
	let m = r + i.length + t.source.length;
	return {
		value: d,
		type: a,
		comment: i.comment,
		range: [
			r,
			m,
			m
		]
	};
}
function Wo({ offset: e, props: t }, n, r) {
	/* istanbul ignore if should not happen */
	if (t[0].type !== "block-scalar-header") return r(t[0], "IMPOSSIBLE", "Block scalar header not found"), null;
	let { source: i } = t[0], a = i[0], o = 0, s = "", c = -1;
	for (let t = 1; t < i.length; ++t) {
		let n = i[t];
		if (!s && (n === "-" || n === "+")) s = n;
		else {
			let r = Number(n);
			!o && r ? o = r : c === -1 && (c = e + t);
		}
	}
	c !== -1 && r(c, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${i}`);
	let l = !1, u = "", d = i.length;
	for (let e = 1; e < t.length; ++e) {
		let i = t[e];
		switch (i.type) {
			case "space": l = !0;
			case "newline":
				d += i.source.length;
				break;
			case "comment":
				n && !l && r(i, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters"), d += i.source.length, u = i.source.substring(1);
				break;
			case "error":
				r(i, "UNEXPECTED_TOKEN", i.message), d += i.source.length;
				break;
			/* istanbul ignore next should not happen */
			default: {
				r(i, "UNEXPECTED_TOKEN", `Unexpected token in block scalar header: ${i.type}`);
				let e = i.source;
				e && typeof e == "string" && (d += e.length);
			}
		}
	}
	return {
		mode: a,
		indent: o,
		chomp: s,
		comment: u,
		length: d
	};
}
function Go(e) {
	let t = e.split(/\n( *)/), n = t[0], r = n.match(/^( *)/), i = [r?.[1] ? [r[1], n.slice(r[1].length)] : ["", n]];
	for (let e = 1; e < t.length; e += 2) i.push([t[e], t[e + 1]]);
	return i;
}
// node_modules/yaml/browser/dist/compose/resolve-flow-scalar.js
function Ko(e, t, n) {
	let { offset: r, type: i, source: a, end: o } = e, s, c, l = (e, t, i) => n(r + e, t, i);
	switch (i) {
		case "scalar":
			s = q.PLAIN, c = qo(a, l);
			break;
		case "single-quoted-scalar":
			s = q.QUOTE_SINGLE, c = Jo(a, l);
			break;
		case "double-quoted-scalar":
			s = q.QUOTE_DOUBLE, c = Xo(a, l);
			break;
		/* istanbul ignore next should not happen */
		default: return n(e, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${i}`), {
			value: "",
			type: null,
			comment: "",
			range: [
				r,
				r + a.length,
				r + a.length
			]
		};
	}
	let u = r + a.length, d = Lo(o, u, t, n);
	return {
		value: c,
		type: s,
		comment: d.comment,
		range: [
			r,
			u,
			d.offset
		]
	};
}
function qo(e, t) {
	let n = "";
	switch (e[0]) {
		/* istanbul ignore next should not happen */
		case "	":
			n = "a tab character";
			break;
		case ",":
			n = "flow indicator character ,";
			break;
		case "%":
			n = "directive indicator character %";
			break;
		case "|":
		case ">":
			n = `block scalar indicator ${e[0]}`;
			break;
		case "@":
		case "`": n = `reserved character ${e[0]}`;
	}
	return n && t(0, "BAD_SCALAR_START", `Plain value cannot start with ${n}`), Yo(e);
}
function Jo(e, t) {
	return (e[e.length - 1] !== "'" || e.length === 1) && t(e.length, "MISSING_CHAR", "Missing closing 'quote"), Yo(e.slice(1, -1)).replace(/''/g, "'");
}
function Yo(e) {
	let t = /(.*?)\r?\n/sy, n = t.exec(e);
	if (!n) return e;
	let r, i;
	try {
		r = /* @__PURE__ */ RegExp("(?<![ 	])[ 	]+$"), i = /* @__PURE__ */ RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
	} catch {
		r = /[ \t]+$/, i = /^[ \t]+|[ \t]+$/g;
	}
	let a = n[1].replace(r, ""), o = " ", s = t.lastIndex;
	for (; n = t.exec(e);) {
		let e = n[1].replace(i, "");
		e === "" ? o === "\n" ? a += o : o = "\n" : (a += o + e, o = " "), s = t.lastIndex;
	}
	let c = /[ \t]*(.*)/sy;
	return c.lastIndex = s, n = c.exec(e), a + o + (n?.[1] ?? "");
}
function Xo(e, t) {
	let n = "";
	for (let r = 1; r < e.length - 1; ++r) {
		let i = e[r];
		if (i !== "\r" || e[r + 1] !== "\n") {
			if (i === "\n") {
				let { fold: t, offset: i } = Zo(e, r);
				n += t, r = i;
			} else if (i === "\\") {
				let i = e[++r], a = Qo[i];
				if (a) n += a;
				else if (i === "\n") for (i = e[r + 1]; i === " " || i === "	";) i = e[++r + 1];
				else if (i === "\r" && e[r + 1] === "\n") for (i = e[++r + 1]; i === " " || i === "	";) i = e[++r + 1];
				else if (i === "x" || i === "u" || i === "U") {
					let a = i === "x" ? 2 : i === "u" ? 4 : 8;
					n += $o(e, r + 1, a, t), r += a;
				} else {
					let i = e.substr(r - 1, 2);
					t(r - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${i}`), n += i;
				}
			} else if (i === " " || i === "	") {
				let t = r, a = e[r + 1];
				for (; a === " " || a === "	";) a = e[++r + 1];
				a !== "\n" && (a !== "\r" || e[r + 2] !== "\n") && (n += r > t ? e.slice(t, r + 1) : i);
			} else n += i;
		}
	}
	return (e[e.length - 1] !== "\"" || e.length === 1) && t(e.length, "MISSING_CHAR", "Missing closing \"quote"), n;
}
function Zo(e, t) {
	let n = "", r = e[t + 1];
	for (; (r === " " || r === "	" || r === "\n" || r === "\r") && (r !== "\r" || e[t + 2] === "\n");) r === "\n" && (n += "\n"), t += 1, r = e[t + 1];
	return n ||= " ", {
		fold: n,
		offset: t
	};
}
var Qo = {
	0: "\0",
	a: "\x07",
	b: "\b",
	e: "\x1B",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "	",
	v: "\v",
	N: "",
	_: "\xA0",
	L: "\u2028",
	P: "\u2029",
	" ": " ",
	"\"": "\"",
	"/": "/",
	"\\": "\\",
	"	": "	"
};
function $o(e, t, n, r) {
	let i = e.substr(t, n), a = i.length === n && /^[0-9a-fA-F]+$/.test(i) ? parseInt(i, 16) : NaN;
	try {
		return String.fromCodePoint(a);
	} catch {
		let i = e.substr(t - 2, n + 2);
		return r(t - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${i}`), i;
	}
}
// node_modules/yaml/browser/dist/compose/compose-scalar.js
function es(e, t, n, r) {
	let { value: i, type: a, comment: o, range: s } = t.type === "block-scalar" ? Uo(e, t, r) : Ko(t, e.options.strict, r), c = n ? e.directives.tagName(n.source, (e) => r(n, "TAG_RESOLVE_FAILED", e)) : null, l;
	l = e.options.stringKeys && e.atKey ? e.schema[B] : c ? ts(e.schema, i, c, n, r) : t.type === "scalar" ? ns(e, i, t, r) : e.schema[B];
	let u;
	try {
		let a = l.resolve(i, (e) => r(n ?? t, "TAG_RESOLVE_FAILED", e), e.options);
		u = U(a) ? a : new q(a);
	} catch (e) {
		let a = e instanceof Error ? e.message : String(e);
		r(n ?? t, "TAG_RESOLVE_FAILED", a), u = new q(i);
	}
	return u.range = s, u.source = i, a && (u.type = a), c && (u.tag = c), l.format && (u.format = l.format), o && (u.comment = o), u;
}
function ts(e, t, n, r, i) {
	if (n === "!") return e[B];
	let a = [];
	for (let t of e.tags) if (!t.collection && t.tag === n) {
		if (t.default && t.test) a.push(t);
		else return t;
	}
	for (let e of a) if (e.test?.test(t)) return e;
	let o = e.knownTags[n];
	return o && !o.collection ? (e.tags.push(Object.assign({}, o, {
		default: !1,
		test: void 0
	})), o) : (i(r, "TAG_RESOLVE_FAILED", `Unresolved tag: ${n}`, n !== "tag:yaml.org,2002:str"), e[B]);
}
function ns({ atKey: e, directives: t, schema: n }, r, i, a) {
	let o = n.tags.find((t) => (t.default === !0 || e && t.default === "key") && t.test?.test(r)) || n[B];
	if (n.compat) {
		let e = n.compat.find((e) => e.default && e.test?.test(r)) ?? n[B];
		o.tag !== e.tag && a(i, "TAG_RESOLVE_FAILED", `Value may be parsed as either ${t.tagString(o.tag)} or ${t.tagString(e.tag)}`, !0);
	}
	return o;
}
// node_modules/yaml/browser/dist/compose/util-empty-scalar-position.js
function rs(e, t, n) {
	if (t) {
		n ??= t.length;
		for (let r = n - 1; r >= 0; --r) {
			let n = t[r];
			switch (n.type) {
				case "space":
				case "comment":
				case "newline":
					e -= n.source.length;
					continue;
			}
			for (n = t[++r]; n?.type === "space";) e += n.source.length, n = t[++r];
			break;
		}
	}
	return e;
}
// node_modules/yaml/browser/dist/compose/compose-node.js
var is = {
	composeNode: as,
	composeEmptyNode: os
};
function as(e, t, n, r) {
	let i = e.atKey, { spaceBefore: a, comment: o, anchor: s, tag: c } = n, l, u = !0;
	switch (t.type) {
		case "alias":
			l = ss(e, t, r), (s || c) && r(t, "ALIAS_PROPS", "An alias node must not specify any properties");
			break;
		case "scalar":
		case "single-quoted-scalar":
		case "double-quoted-scalar":
		case "block-scalar":
			l = es(e, t, c, r), s && (l.anchor = s.source.substring(1));
			break;
		case "block-map":
		case "block-seq":
		case "flow-collection":
			try {
				l = Ho(is, e, t, n, r), s && (l.anchor = s.source.substring(1));
			} catch (e) {
				r(t, "RESOURCE_EXHAUSTION", e instanceof Error ? e.message : String(e));
			}
			break;
		default: r(t, "UNEXPECTED_TOKEN", t.type === "error" ? t.message : `Unsupported token (type: ${t.type})`), u = !1;
	}
	return l ??= os(e, t.offset, void 0, null, n, r), s && l.anchor === "" && r(s, "BAD_ALIAS", "Anchor cannot be an empty string"), i && e.options.stringKeys && (!U(l) || typeof l.value != "string" || l.tag && l.tag !== "tag:yaml.org,2002:str") && r(c ?? t, "NON_STRING_KEY", "With stringKeys, all keys must be strings"), a && (l.spaceBefore = !0), o && (t.type === "scalar" && t.source === "" ? l.comment = o : l.commentBefore = o), e.options.keepSourceTokens && u && (l.srcToken = t), l;
}
function os(e, t, n, r, { spaceBefore: i, comment: a, anchor: o, tag: s, end: c }, l) {
	let u = es(e, {
		type: "scalar",
		offset: rs(t, n, r),
		indent: -1,
		source: ""
	}, s, l);
	return o && (u.anchor = o.source.substring(1), u.anchor === "" && l(o, "BAD_ALIAS", "Anchor cannot be an empty string")), i && (u.spaceBefore = !0), a && (u.comment = a, u.range[2] = c), u;
}
function ss({ options: e }, { offset: t, source: n, end: r }, i) {
	let a = new ki(n.substring(1));
	a.source === "" && i(t, "BAD_ALIAS", "Alias cannot be an empty string"), a.source.endsWith(":") && i(t + n.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", !0);
	let o = t + n.length, s = Lo(r, o, e.strict, i);
	return a.range = [
		t,
		o,
		s.offset
	], s.comment && (a.comment = s.comment), a;
}
// node_modules/yaml/browser/dist/compose/compose-doc.js
function cs(e, t, { offset: n, start: r, value: i, end: a }, o) {
	let s = new wo(void 0, Object.assign({ _directives: t }, e)), c = {
		atKey: !1,
		atRoot: !0,
		directives: s.directives,
		options: s.options,
		schema: s.schema
	}, l = Ao(r, {
		indicator: "doc-start",
		next: i ?? a?.[0],
		offset: n,
		onError: o,
		parentIndent: 0,
		startOnNewline: !0
	});
	l.found && (s.directives.docStart = !0, i && (i.type === "block-map" || i.type === "block-seq") && !l.hasNewline && o(l.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker")), s.contents = i ? as(c, i, l, o) : os(c, l.end, r, null, l, o);
	let u = s.contents.range[2], d = Lo(a, u, !1, o);
	return d.comment && (s.comment = d.comment), s.range = [
		n,
		u,
		d.offset
	], s;
}
// node_modules/yaml/browser/dist/compose/composer.js
function ls(e) {
	if (typeof e == "number") return [e, e + 1];
	if (Array.isArray(e)) return e.length === 2 ? e : [e[0], e[1]];
	let { offset: t, source: n } = e;
	return [t, t + (typeof n == "string" ? n.length : 1)];
}
function us(e) {
	let t = "", n = !1, r = !1;
	for (let i = 0; i < e.length; ++i) {
		let a = e[i];
		switch (a[0]) {
			case "#":
				t += (t === "" ? "" : r ? "\n\n" : "\n") + (a.substring(1) || " "), n = !0, r = !1;
				break;
			case "%":
				e[i + 1]?.[0] !== "#" && (i += 1), n = !1;
				break;
			default: n || (r = !0), n = !1;
		}
	}
	return {
		comment: t,
		afterEmptyLine: r
	};
}
var ds = class {
	constructor(e = {}) {
		this.doc = null, this.atDirectives = !1, this.prelude = [], this.errors = [], this.warnings = [], this.onError = (e, t, n, r) => {
			let i = ls(e);
			r ? this.warnings.push(new Oo(i, t, n)) : this.errors.push(new Do(i, t, n));
		}, this.directives = new Si({ version: e.version || "1.2" }), this.options = e;
	}
	decorate(e, t) {
		let { comment: n, afterEmptyLine: r } = us(this.prelude);
		if (n) {
			let i = e.contents;
			if (t) e.comment = e.comment ? `${e.comment}\n${n}` : n;
			else if (r || e.directives.docStart || !i) e.commentBefore = n;
			else if (W(i) && !i.flow && i.items.length > 0) {
				let e = i.items[0];
				H(e) && (e = e.key);
				let t = e.commentBefore;
				e.commentBefore = t ? `${n}\n${t}` : n;
			} else {
				let e = i.commentBefore;
				i.commentBefore = e ? `${n}\n${e}` : n;
			}
		}
		if (t) {
			for (let t = 0; t < this.errors.length; ++t) e.errors.push(this.errors[t]);
			for (let t = 0; t < this.warnings.length; ++t) e.warnings.push(this.warnings[t]);
		} else e.errors = this.errors, e.warnings = this.warnings;
		this.prelude = [], this.errors = [], this.warnings = [];
	}
	streamInfo() {
		return {
			comment: us(this.prelude).comment,
			directives: this.directives,
			errors: this.errors,
			warnings: this.warnings
		};
	}
	*compose(e, t = !1, n = -1) {
		for (let t of e) yield* this.next(t);
		yield* this.end(t, n);
	}
	*next(e) {
		switch (e.type) {
			case "directive":
				this.directives.add(e.source, (t, n, r) => {
					let i = ls(e);
					i[0] += t, this.onError(i, "BAD_DIRECTIVE", n, r);
				}), this.prelude.push(e.source), this.atDirectives = !0;
				break;
			case "document": {
				let t = cs(this.options, this.directives, e, this.onError);
				this.atDirectives && !t.directives.docStart && this.onError(e, "MISSING_CHAR", "Missing directives-end/doc-start indicator line"), this.decorate(t, !1), this.doc && (yield this.doc), this.doc = t, this.atDirectives = !1;
				break;
			}
			case "byte-order-mark":
			case "space": break;
			case "comment":
			case "newline":
				this.prelude.push(e.source);
				break;
			case "error": {
				let t = e.source ? `${e.message}: ${JSON.stringify(e.source)}` : e.message, n = new Do(ls(e), "UNEXPECTED_TOKEN", t);
				this.atDirectives || !this.doc ? this.errors.push(n) : this.doc.errors.push(n);
				break;
			}
			case "doc-end": {
				if (!this.doc) {
					this.errors.push(new Do(ls(e), "UNEXPECTED_TOKEN", "Unexpected doc-end without preceding document"));
					break;
				}
				this.doc.directives.docEnd = !0;
				let t = Lo(e.end, e.offset + e.source.length, this.doc.options.strict, this.onError);
				if (this.decorate(this.doc, !0), t.comment) {
					let e = this.doc.comment;
					this.doc.comment = e ? `${e}\n${t.comment}` : t.comment;
				}
				this.doc.range[2] = t.offset;
				break;
			}
			default: this.errors.push(new Do(ls(e), "UNEXPECTED_TOKEN", `Unsupported token ${e.type}`));
		}
	}
	*end(e = !1, t = -1) {
		if (this.doc) this.decorate(this.doc, !0), yield this.doc, this.doc = null;
		else if (e) {
			let e = new wo(void 0, Object.assign({ _directives: this.directives }, this.options));
			this.atDirectives && this.onError(t, "MISSING_CHAR", "Missing directives-end indicator line"), e.range = [
				0,
				t,
				t
			], this.decorate(e, !1), yield e;
		}
	}
}, fs = Symbol("break visit"), ps = Symbol("skip children"), ms = Symbol("remove item");
function hs(e, t) {
	"type" in e && e.type === "document" && (e = {
		start: e.start,
		value: e.value
	}), gs(Object.freeze([]), e, t);
}
hs.BREAK = fs, hs.SKIP = ps, hs.REMOVE = ms, hs.itemAtPath = (e, t) => {
	let n = e;
	for (let [e, r] of t) {
		let t = n?.[e];
		if (t && "items" in t) n = t.items[r];
		else return;
	}
	return n;
}, hs.parentCollection = (e, t) => {
	let n = hs.itemAtPath(e, t.slice(0, -1)), r = t[t.length - 1][0], i = n?.[r];
	if (i && "items" in i) return i;
	throw Error("Parent collection not found");
};
function gs(e, t, n) {
	let r = n(t, e);
	if (typeof r == "symbol") return r;
	for (let i of ["key", "value"]) {
		let a = t[i];
		if (a && "items" in a) {
			for (let t = 0; t < a.items.length; ++t) {
				let r = gs(Object.freeze(e.concat([[i, t]])), a.items[t], n);
				if (typeof r == "number") t = r - 1;
				else if (r === fs) return fs;
				else r === ms && (a.items.splice(t, 1), --t);
			}
			typeof r == "function" && i === "key" && (r = r(t, e));
		}
	}
	return typeof r == "function" ? r(t, e) : r;
}
function _s(e) {
	switch (e) {
		case "﻿": return "byte-order-mark";
		case "": return "doc-mode";
		case "": return "flow-error-end";
		case "": return "scalar";
		case "---": return "doc-start";
		case "...": return "doc-end";
		case "":
		case "\n":
		case "\r\n": return "newline";
		case "-": return "seq-item-ind";
		case "?": return "explicit-key-ind";
		case ":": return "map-value-ind";
		case "{": return "flow-map-start";
		case "}": return "flow-map-end";
		case "[": return "flow-seq-start";
		case "]": return "flow-seq-end";
		case ",": return "comma";
	}
	switch (e[0]) {
		case " ":
		case "	": return "space";
		case "#": return "comment";
		case "%": return "directive-line";
		case "*": return "alias";
		case "&": return "anchor";
		case "!": return "tag";
		case "'": return "single-quoted-scalar";
		case "\"": return "double-quoted-scalar";
		case "|":
		case ">": return "block-scalar-header";
	}
	return null;
}
// node_modules/yaml/browser/dist/parse/lexer.js
function Z(e) {
	switch (e) {
		case void 0:
		case " ":
		case "\n":
		case "\r":
		case "	": return !0;
		default: return !1;
	}
}
var vs = /* @__PURE__ */ new Set("0123456789ABCDEFabcdef"), ys = /* @__PURE__ */ new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()"), bs = /* @__PURE__ */ new Set(",[]{}"), xs = /* @__PURE__ */ new Set(" ,[]{}\n\r	"), Ss = (e) => !e || xs.has(e), Cs = class {
	constructor() {
		this.atEnd = !1, this.blockScalarIndent = -1, this.blockScalarKeep = !1, this.buffer = "", this.flowKey = !1, this.flowLevel = 0, this.indentNext = 0, this.indentValue = 0, this.lineEndPos = null, this.next = null, this.pos = 0;
	}
	*lex(e, t = !1) {
		if (e) {
			if (typeof e != "string") throw TypeError("source is not a string");
			this.buffer = this.buffer ? this.buffer + e : e, this.lineEndPos = null;
		}
		this.atEnd = !t;
		let n = this.next ?? "stream";
		for (; n && (t || this.hasChars(1));) n = yield* this.parseNext(n);
	}
	atLineEnd() {
		let e = this.pos, t = this.buffer[e];
		for (; t === " " || t === "	";) t = this.buffer[++e];
		return !t || t === "#" || t === "\n" || t === "\r" && this.buffer[e + 1] === "\n";
	}
	charAt(e) {
		return this.buffer[this.pos + e];
	}
	continueScalar(e) {
		let t = this.buffer[e];
		if (this.indentNext > 0) {
			let n = 0;
			for (; t === " ";) t = this.buffer[++n + e];
			if (t === "\r") {
				let t = this.buffer[n + e + 1];
				if (t === "\n" || !t && !this.atEnd) return e + n + 1;
			}
			return t === "\n" || n >= this.indentNext || !t && !this.atEnd ? e + n : -1;
		}
		if (t === "-" || t === ".") {
			let t = this.buffer.substr(e, 3);
			if ((t === "---" || t === "...") && Z(this.buffer[e + 3])) return -1;
		}
		return e;
	}
	getLine() {
		let e = this.lineEndPos;
		return (typeof e != "number" || e !== -1 && e < this.pos) && (e = this.buffer.indexOf("\n", this.pos), this.lineEndPos = e), e === -1 ? this.atEnd ? this.buffer.substring(this.pos) : null : (this.buffer[e - 1] === "\r" && --e, this.buffer.substring(this.pos, e));
	}
	hasChars(e) {
		return this.pos + e <= this.buffer.length;
	}
	setNext(e) {
		return this.buffer = this.buffer.substring(this.pos), this.pos = 0, this.lineEndPos = null, this.next = e, null;
	}
	peek(e) {
		return this.buffer.substr(this.pos, e);
	}
	*parseNext(e) {
		switch (e) {
			case "stream": return yield* this.parseStream();
			case "line-start": return yield* this.parseLineStart();
			case "block-start": return yield* this.parseBlockStart();
			case "doc": return yield* this.parseDocument();
			case "flow": return yield* this.parseFlowCollection();
			case "quoted-scalar": return yield* this.parseQuotedScalar();
			case "block-scalar": return yield* this.parseBlockScalar();
			case "plain-scalar": return yield* this.parsePlainScalar();
		}
	}
	*parseStream() {
		let e = this.getLine();
		if (e === null) return this.setNext("stream");
		if (e[0] === "﻿" && (yield* this.pushCount(1), e = e.substring(1)), e[0] === "%") {
			let t = e.length, n = e.indexOf("#");
			for (; n !== -1;) {
				let r = e[n - 1];
				if (r === " " || r === "	") {
					t = n - 1;
					break;
				}
				n = e.indexOf("#", n + 1);
			}
			for (;;) {
				let n = e[t - 1];
				if (n === " " || n === "	") --t;
				else break;
			}
			let r = (yield* this.pushCount(t)) + (yield* this.pushSpaces(!0));
			return yield* this.pushCount(e.length - r), this.pushNewline(), "stream";
		}
		if (this.atLineEnd()) {
			let t = yield* this.pushSpaces(!0);
			return yield* this.pushCount(e.length - t), yield* this.pushNewline(), "stream";
		}
		return yield "", yield* this.parseLineStart();
	}
	*parseLineStart() {
		let e = this.charAt(0);
		if (!e && !this.atEnd) return this.setNext("line-start");
		if (e === "-" || e === ".") {
			if (!this.atEnd && !this.hasChars(4)) return this.setNext("line-start");
			let e = this.peek(3);
			if ((e === "---" || e === "...") && Z(this.charAt(3))) return yield* this.pushCount(3), this.indentValue = 0, this.indentNext = 0, e === "---" ? "doc" : "stream";
		}
		return this.indentValue = yield* this.pushSpaces(!1), this.indentNext > this.indentValue && !Z(this.charAt(1)) && (this.indentNext = this.indentValue), yield* this.parseBlockStart();
	}
	*parseBlockStart() {
		let [e, t] = this.peek(2);
		if (!t && !this.atEnd) return this.setNext("block-start");
		if ((e === "-" || e === "?" || e === ":") && Z(t)) {
			let e = (yield* this.pushCount(1)) + (yield* this.pushSpaces(!0));
			return this.indentNext = this.indentValue + 1, this.indentValue += e, "block-start";
		}
		return "doc";
	}
	*parseDocument() {
		yield* this.pushSpaces(!0);
		let e = this.getLine();
		if (e === null) return this.setNext("doc");
		let t = yield* this.pushIndicators();
		switch (e[t]) {
			case "#": yield* this.pushCount(e.length - t);
			case void 0: return yield* this.pushNewline(), yield* this.parseLineStart();
			case "{":
			case "[": return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel = 1, "flow";
			case "}":
			case "]": return yield* this.pushCount(1), "doc";
			case "*": return yield* this.pushUntil(Ss), "doc";
			case "\"":
			case "'": return yield* this.parseQuotedScalar();
			case "|":
			case ">": return t += yield* this.parseBlockScalarHeader(), t += yield* this.pushSpaces(!0), yield* this.pushCount(e.length - t), yield* this.pushNewline(), yield* this.parseBlockScalar();
			default: return yield* this.parsePlainScalar();
		}
	}
	*parseFlowCollection() {
		let e, t, n = -1;
		do
			e = yield* this.pushNewline(), e > 0 ? (t = yield* this.pushSpaces(!1), this.indentValue = n = t) : t = 0, t += yield* this.pushSpaces(!0);
		while (e + t > 0);
		let r = this.getLine();
		if (r === null) return this.setNext("flow");
		if ((n !== -1 && n < this.indentNext && r[0] !== "#" || n === 0 && (r.startsWith("---") || r.startsWith("...")) && Z(r[3])) && (n !== this.indentNext - 1 || this.flowLevel !== 1 || r[0] !== "]" && r[0] !== "}")) return this.flowLevel = 0, yield "", yield* this.parseLineStart();
		let i = 0;
		for (; r[i] === ",";) i += yield* this.pushCount(1), i += yield* this.pushSpaces(!0), this.flowKey = !1;
		switch (i += yield* this.pushIndicators(), r[i]) {
			case void 0: return "flow";
			case "#": return yield* this.pushCount(r.length - i), "flow";
			case "{":
			case "[": return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel += 1, "flow";
			case "}":
			case "]": return yield* this.pushCount(1), this.flowKey = !0, --this.flowLevel, this.flowLevel ? "flow" : "doc";
			case "*": return yield* this.pushUntil(Ss), "flow";
			case "\"":
			case "'": return this.flowKey = !0, yield* this.parseQuotedScalar();
			case ":": {
				let e = this.charAt(1);
				if (this.flowKey || Z(e) || e === ",") return this.flowKey = !1, yield* this.pushCount(1), yield* this.pushSpaces(!0), "flow";
			}
			default: return this.flowKey = !1, yield* this.parsePlainScalar();
		}
	}
	*parseQuotedScalar() {
		let e = this.charAt(0), t = this.buffer.indexOf(e, this.pos + 1);
		if (e === "'") for (; t !== -1 && this.buffer[t + 1] === "'";) t = this.buffer.indexOf("'", t + 2);
		else for (; t !== -1;) {
			let e = 0;
			for (; this.buffer[t - 1 - e] === "\\";) e += 1;
			if (e % 2 == 0) break;
			t = this.buffer.indexOf("\"", t + 1);
		}
		let n = this.buffer.substring(0, t), r = n.indexOf("\n", this.pos);
		if (r !== -1) {
			for (; r !== -1;) {
				let e = this.continueScalar(r + 1);
				if (e === -1) break;
				r = n.indexOf("\n", e);
			}
			r !== -1 && (t = r - (n[r - 1] === "\r" ? 2 : 1));
		}
		if (t === -1) {
			if (!this.atEnd) return this.setNext("quoted-scalar");
			t = this.buffer.length;
		}
		return yield* this.pushToIndex(t + 1, !1), this.flowLevel ? "flow" : "doc";
	}
	*parseBlockScalarHeader() {
		this.blockScalarIndent = -1, this.blockScalarKeep = !1;
		let e = this.pos;
		for (;;) {
			let t = this.buffer[++e];
			if (t === "+") this.blockScalarKeep = !0;
			else if (t > "0" && t <= "9") this.blockScalarIndent = Number(t) - 1;
			else if (t !== "-") break;
		}
		return yield* this.pushUntil((e) => Z(e) || e === "#");
	}
	*parseBlockScalar() {
		let e = this.pos - 1, t = 0, n;
		loop: for (let r = this.pos; n = this.buffer[r]; ++r) switch (n) {
			case " ":
				t += 1;
				break;
			case "\n":
				e = r, t = 0;
				break;
			case "\r": {
				let e = this.buffer[r + 1];
				if (!e && !this.atEnd) return this.setNext("block-scalar");
				if (e === "\n") break;
			}
			default: break loop;
		}
		if (!n && !this.atEnd) return this.setNext("block-scalar");
		if (t >= this.indentNext) {
			this.indentNext = this.blockScalarIndent === -1 ? t : this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
			do {
				let t = this.continueScalar(e + 1);
				if (t === -1) break;
				e = this.buffer.indexOf("\n", t);
			} while (e !== -1);
			if (e === -1) {
				if (!this.atEnd) return this.setNext("block-scalar");
				e = this.buffer.length;
			}
		}
		let r = e + 1;
		for (n = this.buffer[r]; n === " ";) n = this.buffer[++r];
		if (n === "	") {
			for (; n === "	" || n === " " || n === "\r" || n === "\n";) n = this.buffer[++r];
			e = r - 1;
		} else if (!this.blockScalarKeep) do {
			let n = e - 1, r = this.buffer[n];
			r === "\r" && (r = this.buffer[--n]);
			let i = n;
			for (; r === " ";) r = this.buffer[--n];
			if (r === "\n" && n >= this.pos && n + 1 + t > i) e = n;
			else break;
		} while (1);
		return yield "", yield* this.pushToIndex(e + 1, !0), yield* this.parseLineStart();
	}
	*parsePlainScalar() {
		let e = this.flowLevel > 0, t = this.pos - 1, n = this.pos - 1, r;
		for (; r = this.buffer[++n];) if (r === ":") {
			let r = this.buffer[n + 1];
			if (Z(r) || e && bs.has(r)) break;
			t = n;
		} else if (Z(r)) {
			let i = this.buffer[n + 1];
			if (r === "\r" && (i === "\n" ? (n += 1, r = "\n", i = this.buffer[n + 1]) : t = n), i === "#" || e && bs.has(i)) break;
			if (r === "\n") {
				let e = this.continueScalar(n + 1);
				if (e === -1) break;
				n = Math.max(n, e - 2);
			}
		} else {
			if (e && bs.has(r)) break;
			t = n;
		}
		return !r && !this.atEnd ? this.setNext("plain-scalar") : (yield "", yield* this.pushToIndex(t + 1, !0), e ? "flow" : "doc");
	}
	*pushCount(e) {
		return e > 0 ? (yield this.buffer.substr(this.pos, e), this.pos += e, e) : 0;
	}
	*pushToIndex(e, t) {
		let n = this.buffer.slice(this.pos, e);
		return n ? (yield n, this.pos += n.length, n.length) : (t && (yield ""), 0);
	}
	*pushIndicators() {
		let e = 0;
		loop: for (;;) {
			switch (this.charAt(0)) {
				case "!":
					e += yield* this.pushTag(), e += yield* this.pushSpaces(!0);
					continue loop;
				case "&":
					e += yield* this.pushUntil(Ss), e += yield* this.pushSpaces(!0);
					continue loop;
				case "-":
				case "?":
				case ":": {
					let t = this.flowLevel > 0, n = this.charAt(1);
					if (Z(n) || t && bs.has(n)) {
						t ? this.flowKey &&= !1 : this.indentNext = this.indentValue + 1, e += yield* this.pushCount(1), e += yield* this.pushSpaces(!0);
						continue loop;
					}
				}
			}
			break loop;
		}
		return e;
	}
	*pushTag() {
		if (this.charAt(1) === "<") {
			let e = this.pos + 2, t = this.buffer[e];
			for (; !Z(t) && t !== ">";) t = this.buffer[++e];
			return yield* this.pushToIndex(t === ">" ? e + 1 : e, !1);
		}
		{
			let e = this.pos + 1, t = this.buffer[e];
			for (; t;) if (ys.has(t)) t = this.buffer[++e];
			else if (t === "%" && vs.has(this.buffer[e + 1]) && vs.has(this.buffer[e + 2])) t = this.buffer[e += 3];
			else break;
			return yield* this.pushToIndex(e, !1);
		}
	}
	*pushNewline() {
		let e = this.buffer[this.pos];
		return e === "\n" ? yield* this.pushCount(1) : e === "\r" && this.charAt(1) === "\n" ? yield* this.pushCount(2) : 0;
	}
	*pushSpaces(e) {
		let t = this.pos - 1, n;
		do
			n = this.buffer[++t];
		while (n === " " || e && n === "	");
		let r = t - this.pos;
		return r > 0 && (yield this.buffer.substr(this.pos, r), this.pos = t), r;
	}
	*pushUntil(e) {
		let t = this.pos, n = this.buffer[t];
		for (; !e(n);) n = this.buffer[++t];
		return yield* this.pushToIndex(t, !1);
	}
}, ws = class {
	constructor() {
		this.lineStarts = [], this.addNewLine = (e) => this.lineStarts.push(e), this.linePos = (e) => {
			let t = 0, n = this.lineStarts.length;
			for (; t < n;) {
				let r = t + n >> 1;
				this.lineStarts[r] < e ? t = r + 1 : n = r;
			}
			if (this.lineStarts[t] === e) return {
				line: t + 1,
				col: 1
			};
			if (t === 0) return {
				line: 0,
				col: e
			};
			let r = this.lineStarts[t - 1];
			return {
				line: t,
				col: e - r + 1
			};
		};
	}
};
// node_modules/yaml/browser/dist/parse/parser.js
function Ts(e, t) {
	for (let n = 0; n < e.length; ++n) if (e[n].type === t) return !0;
	return !1;
}
function Es(e) {
	for (let t = 0; t < e.length; ++t) switch (e[t].type) {
		case "space":
		case "comment":
		case "newline": break;
		default: return t;
	}
	return -1;
}
function Ds(e) {
	switch (e?.type) {
		case "alias":
		case "scalar":
		case "single-quoted-scalar":
		case "double-quoted-scalar":
		case "flow-collection": return !0;
		default: return !1;
	}
}
function Os(e) {
	switch (e.type) {
		case "document": return e.start;
		case "block-map": {
			let t = e.items[e.items.length - 1];
			return t.sep ?? t.start;
		}
		case "block-seq": return e.items[e.items.length - 1].start;
		/* istanbul ignore next should not happen */
		default: return [];
	}
}
function ks(e) {
	if (e.length === 0) return [];
	let t = e.length;
	loop: for (; --t >= 0;) switch (e[t].type) {
		case "doc-start":
		case "explicit-key-ind":
		case "map-value-ind":
		case "seq-item-ind":
		case "newline": break loop;
	}
	for (; e[++t]?.type === "space";);
	return e.splice(t, e.length);
}
function As(e, t) {
	if (t.length < 1e5) Array.prototype.push.apply(e, t);
	else for (let n = 0; n < t.length; ++n) e.push(t[n]);
}
function js(e) {
	if (e.start.type === "flow-seq-start") for (let t of e.items) t.sep && !t.value && !Ts(t.start, "explicit-key-ind") && !Ts(t.sep, "map-value-ind") && (t.key && (t.value = t.key), delete t.key, Ds(t.value) ? t.value.end ? As(t.value.end, t.sep) : t.value.end = t.sep : As(t.start, t.sep), delete t.sep);
}
var Ms = class {
	constructor(e) {
		this.atNewLine = !0, this.atScalar = !1, this.indent = 0, this.offset = 0, this.onKeyLine = !1, this.stack = [], this.source = "", this.type = "", this.lexer = new Cs(), this.onNewLine = e;
	}
	*parse(e, t = !1) {
		this.onNewLine && this.offset === 0 && this.onNewLine(0);
		for (let n of this.lexer.lex(e, t)) yield* this.next(n);
		t || (yield* this.end());
	}
	*next(e) {
		if (this.source = e, this.atScalar) {
			this.atScalar = !1, yield* this.step(), this.offset += e.length;
			return;
		}
		let t = _s(e);
		if (!t) {
			let t = `Not a YAML token: ${e}`;
			yield* this.pop({
				type: "error",
				offset: this.offset,
				message: t,
				source: e
			}), this.offset += e.length;
		} else if (t === "scalar") this.atNewLine = !1, this.atScalar = !0, this.type = "scalar";
		else {
			switch (this.type = t, yield* this.step(), t) {
				case "newline":
					this.atNewLine = !0, this.indent = 0, this.onNewLine && this.onNewLine(this.offset + e.length);
					break;
				case "space":
					this.atNewLine && e[0] === " " && (this.indent += e.length);
					break;
				case "explicit-key-ind":
				case "map-value-ind":
				case "seq-item-ind":
					this.atNewLine && (this.indent += e.length);
					break;
				case "doc-mode":
				case "flow-error-end": return;
				default: this.atNewLine = !1;
			}
			this.offset += e.length;
		}
	}
	*end() {
		for (; this.stack.length > 0;) yield* this.pop();
	}
	get sourceToken() {
		return {
			type: this.type,
			offset: this.offset,
			indent: this.indent,
			source: this.source
		};
	}
	*step() {
		let e = this.peek(1);
		if (this.type === "doc-end" && e?.type !== "doc-end") {
			for (; this.stack.length > 0;) yield* this.pop();
			this.stack.push({
				type: "doc-end",
				offset: this.offset,
				source: this.source
			});
		} else {
			if (!e) return yield* this.stream();
			switch (e.type) {
				case "document": return yield* this.document(e);
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return yield* this.scalar(e);
				case "block-scalar": return yield* this.blockScalar(e);
				case "block-map": return yield* this.blockMap(e);
				case "block-seq": return yield* this.blockSequence(e);
				case "flow-collection": return yield* this.flowCollection(e);
				case "doc-end": return yield* this.documentEnd(e);
			}
			/* istanbul ignore next should not happen */
			yield* this.pop();
		}
	}
	peek(e) {
		return this.stack[this.stack.length - e];
	}
	*pop(e) {
		let t = e ?? this.stack.pop();
		/* istanbul ignore if should not happen */
		if (!t) yield {
			type: "error",
			offset: this.offset,
			source: "",
			message: "Tried to pop an empty stack"
		};
		else if (this.stack.length === 0) yield t;
		else {
			let e = this.peek(1);
			switch (t.type === "block-scalar" ? t.indent = "indent" in e ? e.indent : 0 : t.type === "flow-collection" && e.type === "document" && (t.indent = 0), t.type === "flow-collection" && js(t), e.type) {
				case "document":
					e.value = t;
					break;
				case "block-scalar":
					e.props.push(t);
					break;
				case "block-map": {
					let n = e.items[e.items.length - 1];
					if (n.value) {
						e.items.push({
							start: [],
							key: t,
							sep: []
						}), this.onKeyLine = !0;
						return;
					}
					if (n.sep) n.value = t;
					else {
						Object.assign(n, {
							key: t,
							sep: []
						}), this.onKeyLine = !n.explicitKey;
						return;
					}
					break;
				}
				case "block-seq": {
					let n = e.items[e.items.length - 1];
					n.value ? e.items.push({
						start: [],
						value: t
					}) : n.value = t;
					break;
				}
				case "flow-collection": {
					let n = e.items[e.items.length - 1];
					!n || n.value ? e.items.push({
						start: [],
						key: t,
						sep: []
					}) : n.sep ? n.value = t : Object.assign(n, {
						key: t,
						sep: []
					});
					return;
				}
				/* istanbul ignore next should not happen */
				default: yield* this.pop(), yield* this.pop(t);
			}
			if ((e.type === "document" || e.type === "block-map" || e.type === "block-seq") && (t.type === "block-map" || t.type === "block-seq")) {
				let n = t.items[t.items.length - 1];
				n && !n.sep && !n.value && n.start.length > 0 && Es(n.start) === -1 && (t.indent === 0 || n.start.every((e) => e.type !== "comment" || e.indent < t.indent)) && (e.type === "document" ? e.end = n.start : e.items.push({ start: n.start }), t.items.splice(-1, 1));
			}
		}
	}
	*stream() {
		switch (this.type) {
			case "directive-line":
				yield {
					type: "directive",
					offset: this.offset,
					source: this.source
				};
				return;
			case "byte-order-mark":
			case "space":
			case "comment":
			case "newline":
				yield this.sourceToken;
				return;
			case "doc-mode":
			case "doc-start": {
				let e = {
					type: "document",
					offset: this.offset,
					start: []
				};
				this.type === "doc-start" && e.start.push(this.sourceToken), this.stack.push(e);
				return;
			}
		}
		yield {
			type: "error",
			offset: this.offset,
			message: `Unexpected ${this.type} token in YAML stream`,
			source: this.source
		};
	}
	*document(e) {
		if (e.value) return yield* this.lineEnd(e);
		switch (this.type) {
			case "doc-start":
				Es(e.start) === -1 ? e.start.push(this.sourceToken) : (yield* this.pop(), yield* this.step());
				return;
			case "anchor":
			case "tag":
			case "space":
			case "comment":
			case "newline":
				e.start.push(this.sourceToken);
				return;
		}
		let t = this.startBlockValue(e);
		t ? this.stack.push(t) : yield {
			type: "error",
			offset: this.offset,
			message: `Unexpected ${this.type} token in YAML document`,
			source: this.source
		};
	}
	*scalar(e) {
		if (this.type === "map-value-ind") {
			let t = ks(Os(this.peek(2))), n;
			e.end ? (n = e.end, n.push(this.sourceToken), delete e.end) : n = [this.sourceToken];
			let r = {
				type: "block-map",
				offset: e.offset,
				indent: e.indent,
				items: [{
					start: t,
					key: e,
					sep: n
				}]
			};
			this.onKeyLine = !0, this.stack[this.stack.length - 1] = r;
		} else yield* this.lineEnd(e);
	}
	*blockScalar(e) {
		switch (this.type) {
			case "space":
			case "comment":
			case "newline":
				e.props.push(this.sourceToken);
				return;
			case "scalar":
				if (e.source = this.source, this.atNewLine = !0, this.indent = 0, this.onNewLine) {
					let e = this.source.indexOf("\n") + 1;
					for (; e !== 0;) this.onNewLine(this.offset + e), e = this.source.indexOf("\n", e) + 1;
				}
				yield* this.pop();
				break;
			/* istanbul ignore next should not happen */
			default: yield* this.pop(), yield* this.step();
		}
	}
	*blockMap(e) {
		let t = e.items[e.items.length - 1];
		switch (this.type) {
			case "newline":
				if (this.onKeyLine = !1, t.value) {
					let n = "end" in t.value ? t.value.end : void 0;
					(Array.isArray(n) ? n[n.length - 1] : void 0)?.type === "comment" ? n?.push(this.sourceToken) : e.items.push({ start: [this.sourceToken] });
				} else t.sep ? t.sep.push(this.sourceToken) : t.start.push(this.sourceToken);
				return;
			case "space":
			case "comment":
				if (t.value) e.items.push({ start: [this.sourceToken] });
				else if (t.sep) t.sep.push(this.sourceToken);
				else {
					if (this.atIndentedComment(t.start, e.indent)) {
						let n = e.items[e.items.length - 2]?.value?.end;
						if (Array.isArray(n)) {
							As(n, t.start), n.push(this.sourceToken), e.items.pop();
							return;
						}
					}
					t.start.push(this.sourceToken);
				}
				return;
		}
		if (this.indent >= e.indent) {
			let n = !this.onKeyLine && this.indent === e.indent, r = n && (t.sep || t.explicitKey) && this.type !== "seq-item-ind", i = [];
			if (r && t.sep && !t.value) {
				let n = [];
				for (let r = 0; r < t.sep.length; ++r) {
					let i = t.sep[r];
					switch (i.type) {
						case "newline":
							n.push(r);
							break;
						case "space": break;
						case "comment":
							i.indent > e.indent && (n.length = 0);
							break;
						default: n.length = 0;
					}
				}
				n.length >= 2 && (i = t.sep.splice(n[1]));
			}
			switch (this.type) {
				case "anchor":
				case "tag":
					r || t.value ? (i.push(this.sourceToken), e.items.push({ start: i }), this.onKeyLine = !0) : t.sep ? t.sep.push(this.sourceToken) : t.start.push(this.sourceToken);
					return;
				case "explicit-key-ind":
					!t.sep && !t.explicitKey ? (t.start.push(this.sourceToken), t.explicitKey = !0) : r || t.value ? (i.push(this.sourceToken), e.items.push({
						start: i,
						explicitKey: !0
					})) : this.stack.push({
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start: [this.sourceToken],
							explicitKey: !0
						}]
					}), this.onKeyLine = !0;
					return;
				case "map-value-ind":
					if (t.explicitKey) {
						if (!t.sep) {
							if (Ts(t.start, "newline")) Object.assign(t, {
								key: null,
								sep: [this.sourceToken]
							});
							else {
								let e = ks(t.start);
								this.stack.push({
									type: "block-map",
									offset: this.offset,
									indent: this.indent,
									items: [{
										start: e,
										key: null,
										sep: [this.sourceToken]
									}]
								});
							}
						} else if (t.value) e.items.push({
							start: [],
							key: null,
							sep: [this.sourceToken]
						});
						else if (Ts(t.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: i,
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else if (Ds(t.key) && !Ts(t.sep, "newline")) {
							let e = ks(t.start), n = t.key, r = t.sep;
							r.push(this.sourceToken), delete t.key, delete t.sep, this.stack.push({
								type: "block-map",
								offset: this.offset,
								indent: this.indent,
								items: [{
									start: e,
									key: n,
									sep: r
								}]
							});
						} else i.length > 0 ? t.sep = t.sep.concat(i, this.sourceToken) : t.sep.push(this.sourceToken);
					} else t.sep ? t.value || r ? e.items.push({
						start: i,
						key: null,
						sep: [this.sourceToken]
					}) : Ts(t.sep, "map-value-ind") ? this.stack.push({
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start: [],
							key: null,
							sep: [this.sourceToken]
						}]
					}) : t.sep.push(this.sourceToken) : Object.assign(t, {
						key: null,
						sep: [this.sourceToken]
					});
					this.onKeyLine = !0;
					return;
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": {
					let n = this.flowScalar(this.type);
					r || t.value ? (e.items.push({
						start: i,
						key: n,
						sep: []
					}), this.onKeyLine = !0) : t.sep ? this.stack.push(n) : (Object.assign(t, {
						key: n,
						sep: []
					}), this.onKeyLine = !0);
					return;
				}
				default: {
					let r = this.startBlockValue(e);
					if (r) {
						if (r.type === "block-seq") {
							if (!t.explicitKey && t.sep && !Ts(t.sep, "newline")) {
								yield* this.pop({
									type: "error",
									offset: this.offset,
									message: "Unexpected block-seq-ind on same line with key",
									source: this.source
								});
								return;
							}
						} else n && e.items.push({ start: i });
						this.stack.push(r);
						return;
					}
				}
			}
		}
		yield* this.pop(), yield* this.step();
	}
	*blockSequence(e) {
		let t = e.items[e.items.length - 1];
		switch (this.type) {
			case "newline":
				if (t.value) {
					let n = "end" in t.value ? t.value.end : void 0;
					(Array.isArray(n) ? n[n.length - 1] : void 0)?.type === "comment" ? n?.push(this.sourceToken) : e.items.push({ start: [this.sourceToken] });
				} else t.start.push(this.sourceToken);
				return;
			case "space":
			case "comment":
				if (t.value) e.items.push({ start: [this.sourceToken] });
				else {
					if (this.atIndentedComment(t.start, e.indent)) {
						let n = e.items[e.items.length - 2]?.value?.end;
						if (Array.isArray(n)) {
							As(n, t.start), n.push(this.sourceToken), e.items.pop();
							return;
						}
					}
					t.start.push(this.sourceToken);
				}
				return;
			case "anchor":
			case "tag":
				if (t.value || this.indent <= e.indent) break;
				t.start.push(this.sourceToken);
				return;
			case "seq-item-ind":
				if (this.indent !== e.indent) break;
				t.value || Ts(t.start, "seq-item-ind") ? e.items.push({ start: [this.sourceToken] }) : t.start.push(this.sourceToken);
				return;
		}
		if (this.indent > e.indent) {
			let t = this.startBlockValue(e);
			if (t) {
				this.stack.push(t);
				return;
			}
		}
		yield* this.pop(), yield* this.step();
	}
	*flowCollection(e) {
		let t = e.items[e.items.length - 1];
		if (this.type === "flow-error-end") {
			let e;
			do
				yield* this.pop(), e = this.peek(1);
			while (e?.type === "flow-collection");
		} else if (e.end.length === 0) {
			switch (this.type) {
				case "comma":
				case "explicit-key-ind":
					!t || t.sep ? e.items.push({ start: [this.sourceToken] }) : t.start.push(this.sourceToken);
					return;
				case "map-value-ind":
					!t || t.value ? e.items.push({
						start: [],
						key: null,
						sep: [this.sourceToken]
					}) : t.sep ? t.sep.push(this.sourceToken) : Object.assign(t, {
						key: null,
						sep: [this.sourceToken]
					});
					return;
				case "space":
				case "comment":
				case "newline":
				case "anchor":
				case "tag":
					!t || t.value ? e.items.push({ start: [this.sourceToken] }) : t.sep ? t.sep.push(this.sourceToken) : t.start.push(this.sourceToken);
					return;
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": {
					let n = this.flowScalar(this.type);
					!t || t.value ? e.items.push({
						start: [],
						key: n,
						sep: []
					}) : t.sep ? this.stack.push(n) : Object.assign(t, {
						key: n,
						sep: []
					});
					return;
				}
				case "flow-map-end":
				case "flow-seq-end":
					e.end.push(this.sourceToken);
					return;
			}
			let n = this.startBlockValue(e);
			/* istanbul ignore else should not happen */
			n ? this.stack.push(n) : (yield* this.pop(), yield* this.step());
		} else {
			let t = this.peek(2);
			if (t.type === "block-map" && (this.type === "map-value-ind" && t.indent === e.indent || this.type === "newline" && !t.items[t.items.length - 1].sep)) yield* this.pop(), yield* this.step();
			else if (this.type === "map-value-ind" && t.type !== "flow-collection") {
				let n = ks(Os(t));
				js(e);
				let r = e.end.splice(1, e.end.length);
				r.push(this.sourceToken);
				let i = {
					type: "block-map",
					offset: e.offset,
					indent: e.indent,
					items: [{
						start: n,
						key: e,
						sep: r
					}]
				};
				this.onKeyLine = !0, this.stack[this.stack.length - 1] = i;
			} else yield* this.lineEnd(e);
		}
	}
	flowScalar(e) {
		if (this.onNewLine) {
			let e = this.source.indexOf("\n") + 1;
			for (; e !== 0;) this.onNewLine(this.offset + e), e = this.source.indexOf("\n", e) + 1;
		}
		return {
			type: e,
			offset: this.offset,
			indent: this.indent,
			source: this.source
		};
	}
	startBlockValue(e) {
		switch (this.type) {
			case "alias":
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar": return this.flowScalar(this.type);
			case "block-scalar-header": return {
				type: "block-scalar",
				offset: this.offset,
				indent: this.indent,
				props: [this.sourceToken],
				source: ""
			};
			case "flow-map-start":
			case "flow-seq-start": return {
				type: "flow-collection",
				offset: this.offset,
				indent: this.indent,
				start: this.sourceToken,
				items: [],
				end: []
			};
			case "seq-item-ind": return {
				type: "block-seq",
				offset: this.offset,
				indent: this.indent,
				items: [{ start: [this.sourceToken] }]
			};
			case "explicit-key-ind": {
				this.onKeyLine = !0;
				let t = ks(Os(e));
				return t.push(this.sourceToken), {
					type: "block-map",
					offset: this.offset,
					indent: this.indent,
					items: [{
						start: t,
						explicitKey: !0
					}]
				};
			}
			case "map-value-ind": {
				this.onKeyLine = !0;
				let t = ks(Os(e));
				return {
					type: "block-map",
					offset: this.offset,
					indent: this.indent,
					items: [{
						start: t,
						key: null,
						sep: [this.sourceToken]
					}]
				};
			}
		}
		return null;
	}
	atIndentedComment(e, t) {
		return this.type !== "comment" || this.indent <= t ? !1 : e.every((e) => e.type === "newline" || e.type === "space");
	}
	*documentEnd(e) {
		this.type !== "doc-mode" && (e.end ? e.end.push(this.sourceToken) : e.end = [this.sourceToken], this.type === "newline" && (yield* this.pop()));
	}
	*lineEnd(e) {
		switch (this.type) {
			case "comma":
			case "doc-start":
			case "doc-end":
			case "flow-seq-end":
			case "flow-map-end":
			case "map-value-ind":
				yield* this.pop(), yield* this.step();
				break;
			case "newline": this.onKeyLine = !1;
			default: e.end ? e.end.push(this.sourceToken) : e.end = [this.sourceToken], this.type === "newline" && (yield* this.pop());
		}
	}
};
// node_modules/yaml/browser/dist/public-api.js
function Ns(e) {
	let t = e.prettyErrors !== !1;
	return {
		lineCounter: e.lineCounter || t && new ws() || null,
		prettyErrors: t
	};
}
function Ps(e, t = {}) {
	let { lineCounter: n, prettyErrors: r } = Ns(t), i = new Ms(n?.addNewLine), a = new ds(t), o = null;
	for (let t of a.compose(i.parse(e), !0, e.length)) if (!o) o = t;
	else if (o.options.logLevel !== "silent") {
		o.errors.push(new Do(t.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
		break;
	}
	return r && n && (o.errors.forEach(ko(e, n)), o.warnings.forEach(ko(e, n))), o;
}
// node_modules/@formdown/core/dist/front-matter.js
var Fs = (e, t) => {
	let n = [], r = Ps(e);
	return r.errors.length > 0 ? (n.push({
		code: "front-matter-invalid-yaml",
		message: `Front matter is not valid YAML: ${r.errors[0].message.split("\n")[0]}`,
		severity: "error",
		span: t
	}), {
		data: {},
		diagnostics: n
	}) : r.contents !== null && !li(r.contents) ? (n.push({
		code: "front-matter-not-mapping",
		message: "Front matter must be a mapping of keys to values",
		severity: "error",
		span: t
	}), {
		data: {},
		diagnostics: n
	}) : {
		data: r.toJS() ?? {},
		diagnostics: n
	};
}, Is = class {
	constructor() {
		this.parser = new an({ frontMatter: Fs });
	}
	extractSchema(e) {
		let t = {};
		return (typeof e == "string" ? this.parser.parseFormdown(e) : e).forms.forEach((e, n) => {
			t[e.name] = this.convertFieldToSchema(e, n);
		}), t;
	}
	convertFieldToSchema(e, t) {
		let n = {
			type: e.type,
			label: e.label,
			required: e.required,
			position: t + 1,
			isInline: e.inline
		};
		e.placeholder && (n.placeholder = e.placeholder), e.value !== void 0 && (n.value = e.value), e.options && (n.options = e.options), e.allowOther && (n.allowOther = e.allowOther), e.otherLabel && (n.otherLabel = e.otherLabel), e.format && (n.format = e.format), e.pattern && (n.pattern = e.pattern), e.description && (n.description = e.description), e.compute && (n.compute = e.compute), on(e) && (n.switch = !0), e.errorMessage && (n.errorMessage = e.errorMessage), e.suggest && (n.suggest = {
			...e.suggest,
			...e.suggest.mustCatch && { mustCatch: [...e.suggest.mustCatch] }
		}), e.relation && (n.relation = { ...e.relation });
		let r = this.extractValidationRules(e.attributes || {}), i = this.extractFieldValidationRules(e);
		(r || i) && (n.validation = {
			...r,
			...i
		});
		let a = this.extractHtmlAttributes(e.attributes || {});
		return a && Object.keys(a).length > 0 && (n.htmlAttributes = a), n.layout = e.inline ? "inline" : "vertical", e.group && (n.group = e.group), e.conditions && (n.conditions = e.conditions), n;
	}
	extractValidationRules(e) {
		let t = {}, n = !1;
		return e.min !== void 0 && (t.min = e.min, n = !0), e.max !== void 0 && (t.max = e.max, n = !0), e.step !== void 0 && (t.step = e.step, n = !0), e.minlength !== void 0 && (t.minlength = e.minlength, n = !0), e.maxlength !== void 0 && (t.maxlength = e.maxlength, n = !0), e.pattern !== void 0 && (t.pattern = e.pattern, n = !0), e.accept !== void 0 && (t.accept = e.accept, n = !0), n ? t : void 0;
	}
	extractFieldValidationRules(e) {
		let t = {}, n = !1;
		return e.pattern !== void 0 && (t.pattern = e.pattern, n = !0), n ? t : void 0;
	}
	extractHtmlAttributes(e) {
		let t = {}, n = /* @__PURE__ */ new Set([
			"min",
			"max",
			"step",
			"minlength",
			"maxlength",
			"pattern",
			"accept",
			"required",
			"placeholder",
			"options",
			"allow-other",
			"other-label",
			"format"
		]), r = !1;
		for (let [i, a] of Object.entries(e)) n.has(i) || (t[i] = a, r = !0);
		return r ? t : void 0;
	}
};
function Ls(e) {
	return new Is().extractSchema(e);
}
// node_modules/@formdown/core/dist/conditions.js
function Rs(e) {
	if (e == null || e === !1) return !1;
	if (Array.isArray(e)) return e.length > 0;
	let t = String(e).trim();
	return t !== "" && t.toLowerCase() !== "false";
}
function zs(e, t) {
	let n = t[e.field];
	switch (e.operator) {
		case "=": return Array.isArray(n) ? n.map(String).includes(e.value ?? "") : Rs(n) && String(n) === e.value;
		case "!=": return !zs({
			...e,
			operator: "="
		}, t);
		case "truthy": return Rs(n);
		case "falsy": return !Rs(n);
	}
}
function Bs(e, t) {
	let n = (e, n) => e ? zs(e, t) : n, r = n(e?.visibleIf, !0) && !n(e?.hiddenIf, !1), i = n(e?.enabledIf, !0) && !n(e?.disabledIf, !1);
	return {
		visible: r,
		enabled: i,
		required: r && i && n(e?.requiredIf, !1)
	};
}
// node_modules/@formdown/core/dist/constraints.js
var Vs = Object.freeze({
	required: "{label} is required",
	minLength: "Must be at least {min} characters",
	maxLength: "Must be at most {max} characters",
	min: "Value must be at least {min}",
	max: "Value must be at most {max}",
	number: "Please enter a valid number",
	email: "Please enter a valid email address",
	url: "Please enter a valid URL",
	tel: "Please enter a valid phone number",
	date: "Please enter a valid date",
	dateMin: "Date must be on or after {min}",
	dateMax: "Date must be on or before {max}",
	pattern: "Value does not match required format"
}), Hs = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, Us = /^[\d\s\-+()]+$/, Ws = /^\d{4}-\d{2}-\d{2}$/;
function Gs(e) {
	return e == null || e === !1 ? !0 : Array.isArray(e) ? e.length === 0 : String(e).trim() === "";
}
function Ks(e, t, n = {}) {
	return e.replace(/\{(label|min|max)\}/g, (e, r) => {
		if (r === "label") return t.label || t.name || "Field";
		let i = n[r];
		return i === void 0 ? "" : String(i);
	});
}
function qs(e) {
	if (e === void 0 || e === "") return;
	let t = Number(e);
	return Number.isFinite(t) ? t : void 0;
}
function Js(e, t, n = {}) {
	let r = Ys(e, t, n);
	if (r.length === 0 || !t.errorMessage) return r;
	let [i] = r, a = i.rule === "required" ? t.requiredMessage : i.rule === "pattern" ? t.patternMessage : void 0;
	return [{
		rule: i.rule,
		message: a || t.errorMessage
	}];
}
function Ys(e, t, n) {
	let r = {
		...Vs,
		...n
	}, i = (e, n) => ({
		rule: e,
		message: Ks(r[e], t, n)
	});
	if (Gs(e)) return t.required ? [{
		rule: "required",
		message: t.requiredMessage || Ks(r.required, t)
	}] : [];
	let a = t.validation ?? {}, o = [], s = Array.isArray(e) ? "" : String(e);
	switch (t.type) {
		case "number":
		case "range": {
			let t = typeof e == "number" ? e : Number(s.trim());
			if (!Number.isFinite(t)) return [i("number")];
			let n = qs(a.min), r = qs(a.max);
			n !== void 0 && t < n && o.push(i("min", { min: n })), r !== void 0 && t > r && o.push(i("max", { max: r }));
			break;
		}
		case "email":
			if (!Hs.test(s)) return [i("email")];
			break;
		case "url":
			try {
				new URL(s);
			} catch {
				return [i("url")];
			}
			break;
		case "tel":
			if (!Us.test(s)) return [i("tel")];
			break;
		case "date": {
			if (!Ws.test(s) || Number.isNaN(Date.parse(s))) return [i("date")];
			let e = typeof a.min == "string" && Ws.test(a.min) ? a.min : void 0, t = typeof a.max == "string" && Ws.test(a.max) ? a.max : void 0;
			e !== void 0 && s < e && o.push(i("dateMin", { min: e })), t !== void 0 && s > t && o.push(i("dateMax", { max: t }));
			break;
		}
	}
	if (typeof e == "string") {
		let n = [...e].length;
		a.minlength !== void 0 && n < a.minlength && o.push(i("minLength", { min: a.minlength })), a.maxlength !== void 0 && n > a.maxlength && o.push(i("maxLength", { max: a.maxlength }));
		let s = t.pattern ?? a.pattern;
		s && !Xs(s, e) && o.push({
			rule: "pattern",
			message: t.patternMessage || Ks(r.pattern, t)
		});
	}
	return o;
}
function Xs(e, t) {
	try {
		return RegExp(`^(?:${e})$`, "v").test(t);
	} catch {
		try {
			return RegExp(`^(?:${e})$`, "u").test(t);
		} catch {
			return !0;
		}
	}
}
// node_modules/@formdown/core/dist/validate.js
function Zs(e, t, n = {}) {
	let r = t.name || "field";
	return Js(e, t, n.messages).map(({ message: e }) => ({
		field: r,
		message: e
	}));
}
function Qs(e, t, n = {}) {
	let r = [];
	return Object.entries(t).forEach(([t, i]) => {
		let a = Bs(i.conditions, e);
		if (a.visible && a.enabled) {
			r.push(...Zs(e[t], {
				...i,
				name: t,
				required: i.required || a.required
			}, n));
			for (let n of j().getFieldTypeRegistry().validate(e[t], {
				...i,
				name: t
			})) r.push({
				field: t,
				message: n
			});
		}
	}), {
		isValid: r.length === 0,
		errors: r
	};
}
// node_modules/@formdown/core/dist/form-data-binding.js
var $s = class {
	constructor(e = null, t = {}) {
		this.schema = e, this.data = {}, this.changeListeners = /* @__PURE__ */ new Set(), this.fieldChangeListeners = /* @__PURE__ */ new Set(), this.validationListeners = /* @__PURE__ */ new Set(), this.isUpdating = !1, this.initializeFromSchema(), this.updateInternal(t, !1);
	}
	set(e, t) {
		this.isUpdating || this.data[e] !== t && (this.data[e] = t, this.notifyFieldChange(e, t), this.notifyChange(), this.validateField(e, t));
	}
	get(e) {
		if (e in this.data) return this.data[e];
		if (this.schema && this.schema[e] && this.schema[e].value !== void 0) return this.schema[e].value;
	}
	getAll() {
		return {
			...this.getSchemaDefaults(),
			...this.data
		};
	}
	updateAll(e) {
		this.updateInternal(e, !0);
	}
	applyDefaults(e, t = {}) {
		if (!this.isUpdating) {
			this.isUpdating = !0;
			try {
				let n = [];
				Object.entries(e).forEach(([e, r]) => {
					(t.override || !this.hasExplicitValue(e)) && this.data[e] !== r && (this.data[e] = r, n.push({
						field: e,
						value: r
					}));
				}), n.length > 0 && (this.isUpdating = !1, n.forEach(({ field: e, value: t }) => {
					this.notifyFieldChange(e, t), this.validateField(e, t);
				}), this.notifyChange());
			} finally {
				this.isUpdating = !1;
			}
		}
	}
	reset() {
		let e = this.getSchemaDefaults();
		this.data = {}, this.updateInternal(e, !0);
	}
	isDirty() {
		let e = this.getAll(), t = this.getSchemaDefaults();
		return JSON.stringify(e) !== JSON.stringify(t);
	}
	validateField(e, t, n) {
		if (!this.schema || !this.schema[e]) return [];
		let r = Zs(t === void 0 ? this.get(e) : t, {
			...this.schema[e],
			name: e
		}, n);
		return this.notifyValidation(e, r), r;
	}
	validate(e) {
		if (!this.schema) return {
			isValid: !0,
			errors: []
		};
		let t = Qs(this.getAll(), this.schema, e), n = /* @__PURE__ */ new Map();
		return t.errors.forEach((e) => {
			n.has(e.field) || n.set(e.field, []), n.get(e.field).push(e);
		}), n.forEach((e, t) => {
			this.notifyValidation(t, e);
		}), t;
	}
	subscribe(e) {
		return this.changeListeners.add(e), () => this.changeListeners.delete(e);
	}
	subscribeToField(e) {
		return this.fieldChangeListeners.add(e), () => this.fieldChangeListeners.delete(e);
	}
	subscribeToValidation(e) {
		return this.validationListeners.add(e), () => this.validationListeners.delete(e);
	}
	updateSchema(e) {
		this.schema = e, this.initializeFromSchema(), this.notifyChange();
	}
	getSchemaDefaults() {
		if (!this.schema) return {};
		let e = {};
		return Object.entries(this.schema).forEach(([t, n]) => {
			n.value !== void 0 && (e[t] = n.value);
		}), e;
	}
	getModifiedFields() {
		return Object.keys(this.data);
	}
	clear(e) {
		if (e in this.data) {
			delete this.data[e];
			let t = this.get(e);
			this.notifyFieldChange(e, t), this.notifyChange();
		}
	}
	hasExplicitValue(e) {
		return e in this.data;
	}
	createSnapshot() {
		return { ...this.data };
	}
	restoreSnapshot(e) {
		this.data = { ...e }, this.notifyChange();
	}
	updateInternal(e, t) {
		if (!this.isUpdating) {
			this.isUpdating = !0;
			try {
				let n = [];
				Object.entries(e).forEach(([e, t]) => {
					this.data[e] !== t && (this.data[e] = t, n.push({
						field: e,
						value: t
					}));
				}), t && n.length > 0 && (n.forEach(({ field: e, value: t }) => {
					this.notifyFieldChange(e, t), this.validateField(e, t);
				}), this.notifyChange());
			} finally {
				this.isUpdating = !1;
			}
		}
	}
	initializeFromSchema() {
		this.schema && Object.entries(this.schema).forEach(([e, t]) => {
			t.value !== void 0 && !(e in this.data) && (this.data[e] = t.value);
		});
	}
	notifyChange() {
		if (this.isUpdating) return;
		let e = this.getAll();
		this.changeListeners.forEach((t) => {
			try {
				t(e);
			} catch (e) {
				console.error("Error in FormDataBinding change listener:", e);
			}
		});
	}
	notifyFieldChange(e, t) {
		if (this.isUpdating) return;
		let n = this.getAll();
		this.fieldChangeListeners.forEach((r) => {
			try {
				r(e, t, n);
			} catch (e) {
				console.error("Error in FormDataBinding field change listener:", e);
			}
		});
	}
	notifyValidation(e, t) {
		this.validationListeners.forEach((n) => {
			try {
				n(e, t);
			} catch (e) {
				console.error("Error in FormDataBinding validation listener:", e);
			}
		});
	}
}, ec = class {
	processCheckboxGroup(e, t) {
		try {
			let n = t.querySelectorAll(`input[type="checkbox"][name="${e}"]`);
			if (n.length === 0) return {
				success: !1,
				value: null,
				errors: ["No checkboxes found"]
			};
			if (n.length === 1 && n[0].value === "true") return {
				success: !0,
				value: n[0].checked || !1
			};
			{
				let e = [];
				return n.forEach((n) => {
					if (n.checked) {
						if (n.value === "" && n.id.includes("_other_checkbox")) {
							let r = t.querySelector(`#${n.id.replace("_checkbox", "_input")}`);
							r && r.value.trim() && e.push(r.value.trim());
						} else n.value !== "" && e.push(n.value);
					}
				}), {
					success: !0,
					value: e
				};
			}
		} catch (e) {
			return {
				success: !1,
				value: null,
				errors: [`Checkbox processing error: ${e}`]
			};
		}
	}
	processRadioGroup(e, t) {
		try {
			let n = t.querySelectorAll(`input[type="radio"][name="${e}"]`);
			if (n.length === 0) return {
				success: !1,
				value: "",
				errors: ["No radio buttons found"]
			};
			let r = "";
			return n.forEach((e) => {
				if (e.checked) {
					if (e.value === "" && e.id.includes("_other_radio")) {
						let n = t.querySelector(`#${e.id.replace("_radio", "_input")}`);
						n && n.value.trim() && (r = n.value.trim());
					} else r = e.value;
				}
			}), {
				success: !0,
				value: r
			};
		} catch (e) {
			return {
				success: !1,
				value: "",
				errors: [`Radio processing error: ${e}`]
			};
		}
	}
	processOtherOption(e, t) {
		let n = !t.includes(e) && e.trim() !== "";
		return {
			hasOtherValue: n,
			otherValue: n ? e : void 0,
			regularValues: t
		};
	}
	extractFieldValue(e, t) {
		if (e.hasAttribute("contenteditable")) return e.textContent?.trim() || "";
		switch (t) {
			case "checkbox": return e.checked || !1;
			case "radio": return e.checked ? e.value : "";
			case "number":
			case "range":
				let t = parseFloat(e.value);
				return isNaN(t) ? 0 : t;
			case "date":
			case "time":
			case "datetime-local":
			case "month":
			case "week": return e.value || "";
			case "file": return e.value && e.value.split("\\").pop() || "";
			default: return e.value || "";
		}
	}
	computeValueSetting(e, t, n) {
		try {
			if (e.hasAttribute("contenteditable")) {
				let n = Array.isArray(t) ? t.join(", ") : String(t ?? "");
				return {
					success: !0,
					elementId: e.id,
					settingType: "textContent",
					value: n
				};
			}
			switch (n) {
				case "checkbox":
					if (Array.isArray(t)) {
						let n = t.includes(e.value);
						return {
							success: !0,
							elementId: e.id,
							settingType: "checked",
							value: n
						};
					}
					return typeof t == "boolean" ? {
						success: !0,
						elementId: e.id,
						settingType: "checked",
						value: t
					} : {
						success: !0,
						elementId: e.id,
						settingType: "checked",
						value: !!t
					};
				case "radio":
					let n = String(t ?? ""), r = e.value === n;
					return {
						success: !0,
						elementId: e.id,
						settingType: "checked",
						value: r
					};
				case "select":
					let i = Array.isArray(t) ? t.join(", ") : String(t ?? "");
					return {
						success: !0,
						elementId: e.id,
						settingType: "value",
						value: i
					};
				case "number":
				case "range":
					let a = typeof t == "number" ? t : parseFloat(String(t));
					return isNaN(a) ? {
						success: !1,
						elementId: e.id,
						settingType: "value",
						value: "",
						error: "Invalid number value"
					} : {
						success: !0,
						elementId: e.id,
						settingType: "value",
						value: String(a)
					};
				default:
					let o = Array.isArray(t) ? t.join(", ") : String(t ?? "");
					return {
						success: !0,
						elementId: e.id,
						settingType: "value",
						value: o
					};
			}
		} catch (t) {
			return {
				success: !1,
				elementId: e.id,
				settingType: "value",
				value: "",
				error: `Value computation error: ${t}`
			};
		}
	}
	validateFieldValue(e, t, n) {
		let r = Js(e, {
			type: t,
			required: n?.required,
			pattern: n?.pattern,
			patternMessage: n?.patternMessage,
			validation: {
				min: n?.min,
				max: n?.max,
				minlength: n?.minLength,
				maxlength: n?.maxLength
			}
		}).map(({ message: e }) => e);
		return {
			success: r.length === 0,
			value: e,
			errors: r.length > 0 ? r : void 0
		};
	}
	getFieldType(e) {
		switch (e.type?.toLowerCase()) {
			case "email": return "email";
			case "password": return "password";
			case "tel": return "tel";
			case "url": return "url";
			case "number": return "number";
			case "date": return "date";
			case "time": return "time";
			case "datetime-local": return "datetime-local";
			case "month": return "month";
			case "week": return "week";
			case "radio": return "radio";
			case "checkbox": return "checkbox";
			case "file": return "file";
			case "color": return "color";
			case "range": return "range";
			case "search": return "search";
			case "hidden": return "hidden";
			case "button": return "button";
			case "submit": return "submit";
			case "reset": return "reset";
			case "textarea": return "textarea";
			case "select": return "select";
			default: return "text";
		}
	}
}, tc = class {
	constructor() {
		this.fieldRegistry = {}, this.syncLock = !1, this.fieldProcessor = new ec();
	}
	bindFieldToElement(e, t) {
		return this.fieldRegistry[e] || (this.fieldRegistry[e] = /* @__PURE__ */ new Set()), this.fieldRegistry[e].add(t), {
			fieldName: e,
			elements: this.fieldRegistry[e],
			unbind: () => this.unbindElement(e, t)
		};
	}
	extractFieldValue(e, t, n) {
		let r = this.fieldProcessor.getFieldType(e);
		if (e.type === "checkbox") {
			let e = this.fieldProcessor.processCheckboxGroup(t, n);
			return e.success ? e.value : null;
		}
		if (e.type === "radio") {
			let e = this.fieldProcessor.processRadioGroup(t, n);
			return e.success ? e.value : "";
		}
		return this.fieldProcessor.extractFieldValue(e, r);
	}
	getValueAssignments(e) {
		let t = [], n = Object.keys(this.fieldRegistry), r = Object.keys(e);
		return [.../* @__PURE__ */ new Set([...n, ...r])].forEach((n) => {
			let r = e[n] ?? "", i = this.fieldRegistry[n];
			i && i.forEach((e) => {
				t.push({
					fieldName: n,
					element: e,
					value: r,
					fieldType: this.fieldProcessor.getFieldType(e)
				});
			});
		}), t;
	}
	acquireSyncLock() {
		return !this.syncLock && (this.syncLock = !0, !0);
	}
	releaseSyncLock() {
		this.syncLock = !1;
	}
	isSyncing() {
		return this.syncLock;
	}
	createFieldChangeEvent(e, t, n) {
		return {
			type: "field-change",
			detail: {
				fieldName: e,
				value: t,
				sourceElement: n
			}
		};
	}
	getFieldProcessor() {
		return this.fieldProcessor;
	}
	unbindElement(e, t) {
		this.fieldRegistry[e] && (this.fieldRegistry[e].delete(t), this.fieldRegistry[e].size === 0 && delete this.fieldRegistry[e]);
	}
	getRegisteredFields() {
		return Object.keys(this.fieldRegistry);
	}
	getFieldElements(e) {
		return this.fieldRegistry[e];
	}
	clearAllBindings() {
		this.fieldRegistry = {}, this.syncLock = !1;
	}
	validateAllFields(e, t) {
		let n = {};
		return Object.keys(this.fieldRegistry).forEach((r) => {
			let i = e[r], a = t?.[r];
			if (a) {
				let e = this.fieldProcessor.getFieldType(a), t = this.fieldProcessor.validateFieldValue(i, e, a);
				n[r] = t;
			}
		}), n;
	}
}, nc = class {
	constructor() {
		this.customValidators = /* @__PURE__ */ new Map(), this.validationCache = /* @__PURE__ */ new Map(), this.asyncValidationTimers = /* @__PURE__ */ new Map();
	}
	registerCustomValidator(e, t) {
		this.customValidators.set(e, t);
	}
	createValidationPipeline(e) {
		return {
			rules: e,
			executeOrder: "fail-fast",
			skipOnError: !0
		};
	}
	async validateAsync(e, t, n) {
		let r = this.getCacheKey(e.fieldName, t);
		if (this.validationCache.has(r)) return this.validationCache.get(r);
		let i = this.buildValidationRules(e), a = this.createValidationPipeline(i), o = await this.executeValidationPipeline(a, e, t, n);
		return this.validationCache.set(r, o), o;
	}
	async executeValidationPipeline(e, t, n, r) {
		let i = [], a = [];
		switch (e.executeOrder) {
			case "fail-fast":
				for (let o of e.rules) {
					let s = await this.executeValidationRule(o, t, n, r);
					if (!s.isValid && (i.push(...s.errors), e.skipOnError)) break;
					s.warnings && a.push(...s.warnings);
				}
				break;
			case "sequential":
				for (let o of e.rules) {
					let e = await this.executeValidationRule(o, t, n, r);
					e.isValid || i.push(...e.errors), e.warnings && a.push(...e.warnings);
				}
				break;
			case "parallel": (await Promise.all(e.rules.map((e) => this.executeValidationRule(e, t, n, r)))).forEach((e) => {
				e.isValid || i.push(...e.errors), e.warnings && a.push(...e.warnings);
			});
		}
		return {
			isValid: i.length === 0,
			errors: i,
			warnings: a.length > 0 ? a : void 0
		};
	}
	async executeValidationRule(e, t, n, r) {
		try {
			let i = await e.validator(n, t, r);
			return typeof i == "boolean" ? {
				isValid: i,
				errors: i ? [] : [{
					field: t.fieldName,
					code: e.name,
					message: e.message || `Validation failed for ${t.fieldName}`,
					severity: "error"
				}]
			} : typeof i == "string" ? {
				isValid: !1,
				errors: [{
					field: t.fieldName,
					code: e.name,
					message: i,
					severity: "error"
				}]
			} : i;
		} catch (e) {
			return {
				isValid: !1,
				errors: [{
					field: t.fieldName,
					code: "validation_error",
					message: `Validation error: ${e}`,
					severity: "error"
				}]
			};
		}
	}
	buildValidationRules(e) {
		let t = [];
		if (t.push({
			name: "constraints",
			validator: (t) => {
				let n = Js(t, {
					name: e.fieldName,
					type: e.fieldType,
					label: typeof e.schema.label == "string" ? e.schema.label : void 0,
					required: e.constraints.required,
					requiredMessage: e.constraints.requiredMessage,
					pattern: e.constraints.pattern,
					patternMessage: e.constraints.patternMessage,
					validation: {
						min: e.constraints.min,
						max: e.constraints.max,
						minlength: e.constraints.minLength,
						maxlength: e.constraints.maxLength
					}
				});
				return {
					isValid: n.length === 0,
					errors: n.map(({ rule: t, message: n }) => ({
						field: e.fieldName,
						code: t,
						message: n,
						severity: "error"
					}))
				};
			}
		}), e.constraints.customValidator && this.customValidators.has(e.constraints.customValidator)) {
			let n = this.customValidators.get(e.constraints.customValidator);
			t.push({
				name: e.constraints.customValidator,
				validator: n,
				async: !0
			});
		}
		return e.constraints.serverValidation && t.push({
			name: "server_validation",
			validator: (e, t, n) => this.validateOnServer(e, t, n),
			async: !0
		}), t;
	}
	async validateOnServer(e, t, n) {
		let r = t.constraints.serverValidation;
		return new Promise((i) => {
			let a = this.asyncValidationTimers.get(t.fieldName);
			a && clearTimeout(a);
			let o = setTimeout(async () => {
				try {
					i(await this.makeValidationRequest(e, t, n, r));
				} catch {
					i({
						isValid: !1,
						errors: [{
							field: t.fieldName,
							code: "server_error",
							message: "Server validation failed",
							severity: "error"
						}]
					});
				}
			}, r.debounceMs || 500);
			this.asyncValidationTimers.set(t.fieldName, o);
		});
	}
	async makeValidationRequest(e, t, n, r) {
		return t.fieldName, {
			isValid: !0,
			errors: []
		};
	}
	validateCrossFields(e, t) {
		let n = [];
		return t.forEach((t) => {
			try {
				let r = t.validator(e);
				typeof r == "string" ? n.push({
					field: t.fields[0],
					code: t.name,
					message: r,
					severity: "error"
				}) : typeof r == "object" && !r.isValid && n.push(...r.errors);
			} catch (e) {
				n.push({
					field: t.fields[0],
					code: "cross_field_error",
					message: `Cross-field validation error: ${e}`,
					severity: "error"
				});
			}
		}), {
			isValid: n.length === 0,
			errors: n
		};
	}
	clearCache(e) {
		if (e) for (let t of this.validationCache.keys()) t.startsWith(`${e}:`) && this.validationCache.delete(t);
		else this.validationCache.clear();
	}
	getCacheKey(e, t) {
		return `${e}:${JSON.stringify(t)}`;
	}
	dispose() {
		this.asyncValidationTimers.forEach((e) => clearTimeout(e)), this.asyncValidationTimers.clear(), this.validationCache.clear();
	}
}, Q = {
	FORM_INITIALIZED: "formdown:form:initialized",
	FORM_READY: "formdown:form:ready",
	FORM_DESTROYED: "formdown:form:destroyed",
	FIELD_FOCUS: "formdown:field:focus",
	FIELD_BLUR: "formdown:field:blur",
	FIELD_CHANGE: "formdown:field:change",
	FIELD_INPUT: "formdown:field:input",
	FIELD_INVALID: "formdown:field:invalid",
	FIELD_VALID: "formdown:field:valid",
	DATA_CHANGE: "formdown:data:change",
	DATA_SYNC: "formdown:data:sync",
	DATA_RESET: "formdown:data:reset",
	VALIDATION_START: "formdown:validation:start",
	VALIDATION_SUCCESS: "formdown:validation:success",
	VALIDATION_ERROR: "formdown:validation:error",
	VALIDATION_COMPLETE: "formdown:validation:complete",
	UI_RENDER_START: "formdown:ui:render:start",
	UI_RENDER_COMPLETE: "formdown:ui:render:complete",
	UI_UPDATE: "formdown:ui:update",
	EDITOR_CONTENT_CHANGE: "formdown:editor:content:change",
	EDITOR_PREVIEW_UPDATE: "formdown:editor:preview:update",
	EDITOR_ERROR: "formdown:editor:error",
	EXTENSION_LOADED: "formdown:extension:loaded",
	EXTENSION_ERROR: "formdown:extension:error",
	SCHEMA_CHANGE: "formdown:schema:change",
	SCHEMA_VALIDATED: "formdown:schema:validated"
}, rc = class {
	constructor(e = {}) {
		this.eventBuses = /* @__PURE__ */ new Map(), this.eventBridges = /* @__PURE__ */ new Map(), this.globalEventConfig = {
			enableFormEvents: !0,
			enableFieldEvents: !0,
			enableValidationEvents: !0,
			enableLifecycleEvents: !0,
			bubbleEvents: !0,
			eventPrefix: "formdown",
			...e
		}, this.globalEventBus = this.createEventBus("global");
	}
	createEventBus(e = `bus_${Date.now()}`) {
		let t = /* @__PURE__ */ new Map(), n = {
			emit: (n, r) => {
				let i = t.get(n);
				i && i.forEach((e) => {
					try {
						e(r);
					} catch (e) {
						console.error(`Error in event handler for ${n}:`, e);
					}
				}), this.globalEventConfig.bubbleEvents && e !== "global" && this.globalEventBus.emit(n, {
					source: e,
					data: r
				});
			},
			on: (e, n) => (t.has(e) || t.set(e, /* @__PURE__ */ new Set()), t.get(e).add(n), () => {
				t.get(e)?.delete(n);
			}),
			off: (e, n) => {
				t.get(e)?.delete(n);
			},
			once: (e, t) => {
				let r = (i) => {
					t(i), n.off(e, r);
				};
				return n.on(e, r);
			},
			clear: () => {
				t.clear();
			}
		};
		return this.eventBuses.set(e, n), n;
	}
	bridgeComponentEvents(e, t, n) {
		let r = `${e.id}_to_${t.id}`, i = {
			source: e,
			target: t,
			eventMappings: n,
			isActive: !0
		};
		return n.forEach((n) => {
			e.on && e.on(n.sourceEvent, (e) => {
				if (!i.isActive || n.condition && !n.condition(e)) return;
				let r = e;
				if (n.transformer) try {
					r = n.transformer(e);
				} catch (e) {
					console.error(`Error in event transformer for ${n.sourceEvent}:`, e);
					return;
				}
				t.emit && t.emit(n.targetEvent, r);
			});
		}), this.eventBridges.set(r, i), r;
	}
	setupGlobalEventHandling() {
		this.globalEventConfig.enableFormEvents && this.setupFormEventHandlers(), this.globalEventConfig.enableFieldEvents && this.setupFieldEventHandlers(), this.globalEventConfig.enableValidationEvents && this.setupValidationEventHandlers(), this.globalEventConfig.enableLifecycleEvents && this.setupLifecycleEventHandlers();
	}
	setupFormEventHandlers() {
		this.globalEventBus.on(Q.FORM_INITIALIZED, (e) => {
			console.debug("Form initialized:", e);
		}), this.globalEventBus.on(Q.DATA_CHANGE, (e) => {
			this.globalEventBus.emit(Q.DATA_SYNC, e);
		}), this.globalEventBus.on(Q.FORM_DESTROYED, (e) => {
			this.cleanupFormEventBridges(e?.formId);
		});
	}
	setupFieldEventHandlers() {
		this.globalEventBus.on(Q.FIELD_CHANGE, (e) => {
			this.globalEventBus.emit(Q.VALIDATION_START, {
				fieldName: e.fieldName,
				value: e.value
			});
		}), this.globalEventBus.on(Q.FIELD_INVALID, (e) => {
			console.debug("Field validation error:", e);
		});
	}
	setupValidationEventHandlers() {
		this.globalEventBus.on(Q.VALIDATION_ERROR, (e) => {
			console.debug("Validation error:", e);
		}), this.globalEventBus.on(Q.VALIDATION_SUCCESS, (e) => {
			console.debug("Validation success:", e);
		});
	}
	setupLifecycleEventHandlers() {
		this.globalEventBus.on(Q.UI_RENDER_COMPLETE, (e) => {
			this.globalEventBus.emit(Q.FORM_READY, e);
		}), this.globalEventBus.on(Q.EXTENSION_LOADED, (e) => {
			console.debug("Extension loaded:", e);
		});
	}
	createCoreUIBridge(e, t) {
		let n = [
			{
				sourceEvent: Q.DATA_CHANGE,
				targetEvent: Q.UI_UPDATE,
				transformer: (e) => ({ formData: e.formData })
			},
			{
				sourceEvent: Q.VALIDATION_ERROR,
				targetEvent: Q.FIELD_INVALID,
				transformer: (e) => ({
					fieldName: e.field,
					errors: e.errors
				})
			},
			{
				sourceEvent: Q.VALIDATION_SUCCESS,
				targetEvent: Q.FIELD_VALID,
				transformer: (e) => ({ fieldName: e.field })
			},
			{
				sourceEvent: Q.FIELD_CHANGE,
				targetEvent: Q.DATA_CHANGE,
				transformer: (e) => ({
					fieldName: e.fieldName,
					value: e.value,
					formData: e.formData
				})
			}
		];
		return this.bridgeComponentEvents(e, t, n);
	}
	createCoreEditorBridge(e, t) {
		let n = [
			{
				sourceEvent: Q.SCHEMA_CHANGE,
				targetEvent: Q.EDITOR_PREVIEW_UPDATE,
				transformer: (e) => ({ schema: e.schema })
			},
			{
				sourceEvent: Q.EDITOR_CONTENT_CHANGE,
				targetEvent: Q.SCHEMA_CHANGE,
				transformer: (e) => ({ content: e.content })
			},
			{
				sourceEvent: Q.VALIDATION_ERROR,
				targetEvent: Q.EDITOR_ERROR,
				transformer: (e) => ({ errors: e.errors })
			}
		];
		return this.bridgeComponentEvents(e, t, n);
	}
	getGlobalEventBus() {
		return this.globalEventBus;
	}
	getEventBus(e) {
		return this.eventBuses.get(e);
	}
	removeBridge(e) {
		let t = this.eventBridges.get(e);
		t && (t.isActive = !1, this.eventBridges.delete(e));
	}
	cleanupFormEventBridges(e) {
		if (e) for (let [t, n] of this.eventBridges.entries()) t.includes(e) && this.removeBridge(t);
	}
	getActiveBridges() {
		return Array.from(this.eventBridges.values()).filter((e) => e.isActive);
	}
	dispose() {
		this.eventBuses.forEach((e) => e.clear()), this.eventBuses.clear(), this.eventBridges.forEach((e) => {
			e.isActive = !1;
		}), this.eventBridges.clear(), this.globalEventBus.clear();
	}
	configureEvents(e) {
		this.globalEventConfig = {
			...this.globalEventConfig,
			...e
		}, this.setupGlobalEventHandling();
	}
	getEventStats() {
		return {
			totalEventBuses: this.eventBuses.size,
			totalBridges: this.eventBridges.size,
			activeBridges: this.getActiveBridges().length
		};
	}
}, ic = class e {
	constructor(e = {}) {
		this.options = e, this.content = "", this.parsedContent = null, this.schema = null, this.dataBinding = null, this.eventListeners = /* @__PURE__ */ new Map(), this._pendingDefaults = null, this.fieldProcessor = null, this.domBinder = null, this.validationManager = null, this.eventOrchestrator = null, this.parser = new an({
			frontMatter: Fs,
			...e
		}), this.generator = new ti({ html: e.html }), Object.keys({}).forEach((e) => {
			this.eventListeners.set(e, /* @__PURE__ */ new Set());
		});
	}
	parse(e) {
		return this.content = e, this.parsedContent = this.parser.parseFormdown(e), this.schema = Ls(this.parsedContent), this.dataBinding = new $s(this.schema), this._pendingDefaults &&= (this.dataBinding.applyDefaults(this._pendingDefaults.defaults, this._pendingDefaults.options), null), this.setupDataBindingEvents(), this.parsedContent;
	}
	render(e = {}) {
		if (!this.parsedContent) throw Error("No content parsed. Call parse() first.");
		return e.outputFormat === "json" ? JSON.stringify(this.parsedContent, null, 2) : this.generator.generateHTML(this.parsedContent, { html: e.html });
	}
	getSchema() {
		return this.schema ? { ...this.schema } : null;
	}
	getData() {
		return this.dataBinding ? this.dataBinding.getAll() : {};
	}
	setFieldValue(e, t) {
		this.dataBinding && this.dataBinding.set(e, t);
	}
	updateData(e) {
		this.dataBinding && this.dataBinding.updateAll(e);
	}
	setDefaults(e, t = {}) {
		this.dataBinding ? this.dataBinding.applyDefaults(e, t) : this._pendingDefaults = {
			defaults: e,
			options: t
		};
	}
	reset() {
		this.dataBinding && (this.dataBinding.reset(), this.emit("form-reset", { formData: this.getData() }));
	}
	validate(e) {
		return this.dataBinding ? this.dataBinding.validate(e) : {
			isValid: !0,
			errors: []
		};
	}
	getDefaultValues() {
		return this.dataBinding ? this.dataBinding.getSchemaDefaults() : {};
	}
	isDirty() {
		return this.dataBinding ? this.dataBinding.isDirty() : !1;
	}
	getField(e) {
		return this.parsedContent && this.parsedContent.forms.find((t) => t.name === e) || null;
	}
	getFields() {
		return this.parsedContent?.forms || [];
	}
	getActions() {
		let e = /* @__PURE__ */ new Set([
			"submit",
			"reset",
			"button",
			"image"
		]);
		return this.getFields().filter((t) => !!(e.has(t.type) || t.attributes?.type && e.has(String(t.attributes.type))));
	}
	getInputFields() {
		let e = /* @__PURE__ */ new Set([
			"submit",
			"reset",
			"button",
			"image"
		]);
		return this.getFields().filter((t) => !(e.has(t.type) || t.attributes?.type && e.has(String(t.attributes.type))));
	}
	getFormDeclarations() {
		return this.parsedContent?.formDeclarations || [];
	}
	on(e, t) {
		this.eventListeners.has(e) || this.eventListeners.set(e, /* @__PURE__ */ new Set()), this.eventListeners.get(e).add(t);
	}
	off(e, t) {
		let n = this.eventListeners.get(e);
		n && n.delete(t);
	}
	emit(e, t) {
		let n = this.eventListeners.get(e);
		n && n.forEach((n) => {
			try {
				n(t);
			} catch (t) {
				console.error(`Error in FormManager event handler for '${e}':`, t);
			}
		});
	}
	setupDataBindingEvents() {
		this.dataBinding && (this.dataBinding.subscribeToField((e, t, n) => {
			this.emit("data-change", {
				field: e,
				value: t,
				formData: n
			});
		}), this.dataBinding.subscribeToValidation((e, t) => {
			t.length > 0 && this.emit("validation-error", {
				field: e,
				errors: t
			});
		}));
	}
	clone() {
		return new e(this.options);
	}
	export() {
		return {
			content: this.content,
			data: this.getData(),
			schema: this.getSchema(),
			options: { ...this.options }
		};
	}
	import(e) {
		e.options && (Object.assign(this.options, e.options), this.parser = new an({
			frontMatter: Fs,
			...this.options
		})), this.parse(e.content), e.data && this.updateData(e.data);
	}
	createFieldProcessor() {
		return this.fieldProcessor ||= new ec(), this.fieldProcessor;
	}
	createDOMBinder() {
		return this.domBinder ||= new tc(), this.domBinder;
	}
	createValidationManager() {
		return this.validationManager ||= new nc(), this.validationManager;
	}
	createEventOrchestrator() {
		return this.eventOrchestrator ||= new rc(), this.eventOrchestrator;
	}
	processFieldValue(e, t) {
		let n = this.createFieldProcessor(), r = this.getField(e);
		if (!r) return console.warn(`Field ${e} not found in schema`), t;
		let i = n.getFieldType({
			id: e,
			name: e,
			value: String(t),
			type: r.type || "text",
			hasAttribute: () => !1,
			getAttribute: () => null
		});
		return n.extractFieldValue({
			id: e,
			name: e,
			value: String(t),
			type: r.type || "text",
			hasAttribute: () => !1,
			getAttribute: () => null
		}, i);
	}
	async validateFieldWithPipeline(e, t) {
		let n = this.createValidationManager(), r = this.getField(e), i = this.createFieldProcessor();
		if (!r) return {
			isValid: !1,
			errors: [`Field ${e} not found`]
		};
		let a = {
			fieldName: e,
			fieldType: i.getFieldType({
				id: e,
				name: e,
				value: String(t),
				type: r.type || "text",
				hasAttribute: () => !1,
				getAttribute: () => null
			}),
			constraints: r.attributes || {},
			schema: r
		};
		return await n.validateAsync(a, t, this.getData());
	}
	setupComponentBridge(e) {
		let t = this.createEventOrchestrator(), n = {
			id: "formdown-core",
			type: "core",
			emit: (e, t) => {
				e === "formdown:data:change" ? this.emit("data-change", t) : e === "formdown:validation:error" && this.emit("validation-error", t);
			},
			on: (e, t) => (e === "formdown:field:change" && this.on("data-change", t), () => {})
		};
		return e.type === "ui" ? t.createCoreUIBridge(n, e) : e.type === "editor" ? t.createCoreEditorBridge(n, e) : t.bridgeComponentEvents(n, e, []);
	}
	renderToTemplate(e = {}) {
		if (!this.parsedContent) throw Error("No content parsed. Call parse() first.");
		return {
			fields: this.getFields(),
			formDeclarations: this.getFormDeclarations(),
			schema: this.getSchema(),
			data: this.getData(),
			html: this.render({ html: e.html }),
			options: e
		};
	}
	handleUIEvent(e, t) {
		t ||= this.createDOMBinder();
		let n = e.target, r = n?.name || n?.id;
		if (r && e.type === "change") {
			let e = this.createFieldProcessor(), t = e.getFieldType(n), i = e.extractFieldValue(n, t);
			this.setFieldValue(r, i);
		}
	}
	createPreviewTemplate(t) {
		try {
			let n = new e(this.options), r = n.parse(t);
			return {
				html: n.render(),
				errors: r.diagnostics ?? [],
				schema: n.getSchema(),
				fields: n.getFields()
			};
		} catch (e) {
			return {
				html: "",
				errors: [{
					code: "parse-failure",
					message: String(e),
					severity: "error"
				}],
				schema: null,
				fields: []
			};
		}
	}
	getCoreModules() {
		return {
			fieldProcessor: this.fieldProcessor,
			domBinder: this.domBinder,
			validationManager: this.validationManager,
			eventOrchestrator: this.eventOrchestrator
		};
	}
	dispose() {
		this.validationManager &&= (this.validationManager.dispose(), null), this.domBinder &&= (this.domBinder.clearAllBindings(), null), this.eventOrchestrator &&= (this.eventOrchestrator.dispose(), null), this.fieldProcessor = null, this._pendingDefaults = null, this.eventListeners.clear(), this.dataBinding &&= null;
	}
};
// node_modules/@formdown/ui/dist/index.es.js
function ac(e) {
	return e.localName.includes("-") ? customElements.get(e.localName) : void 0;
}
function oc(e) {
	return e.hasAttribute("name") && ac(e)?.formAssociated === !0;
}
function sc(e) {
	return Array.from(e.querySelectorAll("[name]")).filter((e) => oc(e));
}
function cc(e) {
	let t = Array.from(e.querySelectorAll("[name]")).filter((e) => e.localName.includes("-") && !customElements.get(e.localName)).map((e) => e.localName);
	return [...new Set(t)];
}
function lc(e) {
	let t = e.value;
	return t == null ? "" : typeof t == "boolean" || typeof t == "string" ? t : Array.isArray(t) ? t.map(String) : String(t);
}
function uc(e, t) {
	e.value = t ?? "";
}
function dc(e, t, n) {
	e.toggleAttribute("disabled", !t), e.toggleAttribute("required", n);
}
function fc(e) {
	return e === !0 || typeof e == "string" && e.toLowerCase() === "true";
}
function pc(e, t, n) {
	oc(e) ? uc(e, t) : e instanceof HTMLInputElement ? n === "checkbox" || e.type === "checkbox" ? e.checked = Array.isArray(t) ? t.map(String).includes(e.value) : e.value === "true" ? fc(t) : t != null && String(t) === e.value : n === "radio" || e.type === "radio" ? e.checked = t != null && e.value === String(t) : e.value = String(t ?? "") : e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement ? e.value = String(t ?? "") : e.hasAttribute("contenteditable") && (e.textContent = String(t ?? ""));
}
function mc(e, t) {
	let n = [];
	for (let [r, i] of Object.entries(t)) {
		let t = (Array.isArray(i) ? i : [i]).filter((e) => e != null && typeof e != "boolean").map(String).filter((e) => e !== "");
		if (t.length === 0) continue;
		let a = Array.from(e.querySelectorAll("select")).find((e) => e.name === r);
		if (a) {
			if (a.hasAttribute("data-formdown-has-other")) continue;
			for (let e of t) {
				if (Array.from(a.options).some((t) => t.value === e)) continue;
				let t = a.ownerDocument.createElement("option");
				t.value = e, t.textContent = e, t.setAttribute("data-formdown-unlisted", "true"), a.append(t);
			}
			continue;
		}
		let o = Array.from(e.querySelectorAll("input[type=\"radio\"], input[type=\"checkbox\"]")).filter((e) => e.name === r);
		if (o.length === 0 || o.every((e) => e.type === "checkbox" && e.value === "true") || o.some((e) => e.hasAttribute("data-formdown-other-radio") || e.hasAttribute("data-formdown-other-checkbox"))) continue;
		let s = o[o.length - 1], c = s.closest("label"), l = c ?? s;
		for (let e of s.type === "radio" ? t.slice(0, 1) : t) {
			if (o.some((t) => t.value === e)) continue;
			let t = s.ownerDocument, i = t.createElement("input");
			i.type = s.type, i.name = r, i.value = e, i.id = `${s.id || r}_unlisted_${n.length}`, i.setAttribute("data-formdown-unlisted", "true");
			let a = t.createElement("span");
			a.textContent = e;
			let u = t.createElement("label");
			u.className = c?.className || "formdown-option-label", u.setAttribute("part", c?.getAttribute("part") || "option-label"), u.htmlFor = i.id, u.append(i, a), l.after(u), l = u, o.push(i), n.push(i);
		}
	}
	return n;
}
var hc = /* @__PURE__ */ new Set([
	"date",
	"time",
	"datetime-local",
	"month",
	"week",
	"number",
	"range",
	"color"
]), gc = "data-formdown-unread", _c = "formdown-unread";
function vc(e, t) {
	return e.type === "color" ? e.value === t.toLowerCase() : e.value === t;
}
function yc(e, t, n) {
	let r = (e.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((e) => e && e !== t);
	n && r.push(t), r.length > 0 ? e.setAttribute("aria-describedby", r.join(" ")) : e.removeAttribute("aria-describedby");
}
function bc(e, t) {
	for (let n of Array.from(e.querySelectorAll("input"))) {
		if (!hc.has(n.type)) continue;
		let e = t[n.name], r = typeof e == "string" || typeof e == "number" ? String(e) : "", i = r !== "" && !vc(n, r), a = `${n.id || n.name}_unread`, o = n.nextElementSibling?.classList.contains(_c) ? n.nextElementSibling : null;
		if (!i) {
			o && o.remove(), n.hasAttribute(gc) && (n.removeAttribute(gc), yc(n, a, !1));
			continue;
		}
		n.setAttribute(gc, "true");
		let s = o ?? n.ownerDocument.createElement("span");
		s.className = _c, s.id = a, s.setAttribute("part", "unread-value"), s.setAttribute(gc, n.name), s.textContent = r, o || n.after(s), yc(n, a, !0);
	}
}
var xc = "data-formdown-choice", Sc = "data-formdown-unlisted", Cc = (e) => e.label ?? e.value;
function wc(e, t) {
	let n = [];
	for (let n of Array.from(e.querySelectorAll("select"))) {
		if (n.hasAttribute("data-formdown-has-other")) continue;
		let e = t[n.name] ?? [];
		for (let t of Array.from(n.options)) t.hasAttribute(xc) && !e.some((e) => e.value === t.value) && t.remove();
		for (let t of e) {
			let e = Array.from(n.options).find((e) => e.value === t.value);
			if (e) {
				(e.hasAttribute(Sc) || e.hasAttribute(xc)) && Tc(e, t);
				continue;
			}
			let r = n.ownerDocument.createElement("option");
			r.value = t.value, Tc(r, t);
			let i = Array.from(n.options).find((e) => e.hasAttribute(Sc));
			n.insertBefore(r, i ?? null);
		}
	}
	let r = /* @__PURE__ */ new Map();
	for (let t of Array.from(e.querySelectorAll("input[type=\"radio\"], input[type=\"checkbox\"]"))) r.set(t.name, [...r.get(t.name) ?? [], t]);
	for (let [e, i] of r) {
		if (i.every((e) => e.type === "checkbox" && e.value === "true") || i.some((e) => e.hasAttribute("data-formdown-other-radio") || e.hasAttribute("data-formdown-other-checkbox"))) continue;
		let r = t[e] ?? [], a = i.filter((e) => e.hasAttribute(xc) && !r.some((t) => t.value === e.value)), o = [...i];
		for (let t of r) {
			let r = o.find((e) => e.value === t.value);
			if (r) {
				if (r.hasAttribute(Sc) || r.hasAttribute(xc)) {
					r.removeAttribute(Sc), r.setAttribute(xc, "true");
					let e = r.closest("label")?.querySelector("span");
					e && (e.textContent = Cc(t));
				}
				continue;
			}
			let i = o.filter((e) => !e.hasAttribute(Sc)), a = i[i.length - 1] ?? o[o.length - 1], s = a.closest("label"), c = a.ownerDocument, l = c.createElement("input");
			l.type = a.type, l.name = e, l.value = t.value, l.id = `${e}_choice_${n.length}_${o.length}`, l.setAttribute(xc, "true");
			let u = c.createElement("span");
			u.textContent = Cc(t);
			let d = c.createElement("label");
			d.className = s?.className || "formdown-option-label", d.setAttribute("part", s?.getAttribute("part") || "option-label"), d.htmlFor = l.id, d.append(l, u), (s ?? a).after(d), o.splice(o.indexOf(a) + 1, 0, l), n.push(l);
		}
		for (let e of a) (e.closest("label") ?? e).remove();
	}
	for (let n of Array.from(e.querySelectorAll("input[name]"))) {
		if ([
			"radio",
			"checkbox",
			"hidden",
			"file",
			"range",
			"color",
			"submit",
			"button",
			"reset"
		].includes(n.type)) continue;
		let r = `formdown-choices-${n.name}`, i = t[n.name] ?? [], a = Array.from(e.querySelectorAll("datalist")).find((e) => e.id === r);
		if (i.length === 0) {
			a?.remove(), n.getAttribute("list") === r && n.removeAttribute("list");
			continue;
		}
		let o = a ?? n.ownerDocument.createElement("datalist");
		o.id = r, o.replaceChildren(...i.map((e) => {
			let t = n.ownerDocument.createElement("option");
			return t.value = e.value, t.label = Cc(e), t;
		})), a || n.after(o), n.setAttribute("list", r);
	}
	return n;
}
function Tc(e, t) {
	e.removeAttribute(Sc), e.setAttribute(xc, "true"), e.textContent = Cc(t);
}
var Ec = "data-formdown-note", Dc = "data-formdown-value", Oc = "data-formdown-placeholder", kc = "formdown-ghost", Ac = "formdown-suggested";
function jc(e, t) {
	let n = Array.from(e.querySelectorAll("[name]")).filter((e) => e.getAttribute("name") === t);
	if (n.length > 0) return n;
	let r = Array.from(e.querySelectorAll("[data-field-name]")).find((e) => e.dataset.fieldName === t);
	return r ? [r] : [];
}
function Mc(e) {
	return e.isContentEditable || e.getAttribute("contenteditable") === "true";
}
function Nc(e) {
	return e instanceof HTMLTextAreaElement || e instanceof HTMLInputElement && ![
		"radio",
		"checkbox",
		"hidden",
		"file",
		"range",
		"color",
		"submit",
		"button",
		"reset"
	].includes(e.type);
}
function Pc(e, t) {
	e.classList.remove(t), e.classList.length === 0 && e.removeAttribute("class");
}
function Fc(e, t) {
	let n = Mc(e) ? "data-placeholder" : Nc(e) ? "placeholder" : null;
	n && (e.hasAttribute(Oc) || e.setAttribute(Oc, e.getAttribute(n) ?? ""), e.setAttribute(n, t), e.classList.add(kc));
}
function Ic(e, t) {
	let [n] = e;
	return n instanceof HTMLSelectElement ? Array.from(n.options).find((e) => e.value === t)?.textContent?.trim() || t : e.find((e) => e instanceof HTMLInputElement && (e.type === "radio" || e.type === "checkbox") && e.value === t)?.closest("label")?.textContent?.trim() || t;
}
function Lc(e) {
	let [t] = e;
	if (t instanceof HTMLSelectElement) return Array.from(t.selectedOptions).map((e) => e.value).filter(Boolean);
	if (t instanceof HTMLInputElement && (t.type === "radio" || t.type === "checkbox")) return e.filter((e) => e instanceof HTMLInputElement && e.checked).map((e) => e.value);
	let n;
	return n = oc(t) ? lc(t) : t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t.value : Mc(t) ? (t.textContent ?? "").trim() : "", (Array.isArray(n) ? n : [String(n)]).filter((e) => e !== "");
}
function Rc(e, t) {
	let n = e[0].closest(".formdown-field")?.querySelector("[part~=\"label\"], [part~=\"legend\"]")?.textContent?.trim();
	return n ? n.replace(/\s*\*$/, "") : t;
}
function zc(e) {
	for (let t of Array.from(e.querySelectorAll(`[${Ec}]`))) {
		let n = jc(e, t.getAttribute(Ec)), r = n.length > 0 ? Lc(n) : [];
		for (let e of Array.from(t.querySelectorAll(`[${Dc}]`))) e.setAttribute("aria-pressed", String(r.includes(e.getAttribute(Dc))));
	}
}
function Bc(e, t, n, r, i, a) {
	let o = n.suggestions ?? [];
	if (!n.note && o.length === 0) return;
	let s = e.createElement(r ? "span" : "div");
	if (s.className = "formdown-field-note", s.setAttribute("part", "field-note"), s.setAttribute(Ec, t), o.length > 0 && (s.setAttribute("role", "group"), s.setAttribute("aria-label", n.label ?? `Suggestions for ${Rc(a, t)}`)), n.note) {
		let t = e.createElement("span");
		t.className = "formdown-field-note-text", t.textContent = n.note, s.append(t);
	}
	for (let n of o) {
		let r = e.createElement("button");
		r.type = "button", r.className = "formdown-suggestion", r.setAttribute("part", "suggestion"), r.setAttribute(Dc, n), r.textContent = Ic(a, n), r.addEventListener("click", () => i.onPick(t, n)), s.append(r);
	}
	if (n.decline && o.length > 0) {
		let r = e.createElement("button");
		r.type = "button", r.className = "formdown-decline", r.setAttribute("part", "decline"), r.textContent = n.decline, r.addEventListener("click", () => i.onDecline(t)), s.append(r);
	}
	return s;
}
function Vc(e) {
	for (let t of Array.from(e.querySelectorAll(`[${Ec}]`))) t.remove();
	for (let t of Array.from(e.querySelectorAll(`[${Oc}]`))) {
		let e = Mc(t) ? "data-placeholder" : "placeholder", n = t.getAttribute(Oc) ?? "";
		n ? t.setAttribute(e, n) : t.removeAttribute(e), t.removeAttribute(Oc), Pc(t, kc);
	}
	for (let t of Array.from(e.querySelectorAll(`.${Ac}`))) Pc(t, Ac);
}
function Hc(e, t, n) {
	let r = Wc(e);
	Vc(e);
	let i = e.ownerDocument ?? e;
	for (let [r, a] of Object.entries(t)) {
		let t = jc(e, r);
		if (t.length === 0) continue;
		let [o] = t, s = a.suggestions ?? [];
		s.length > 0 && Fc(o, s[0]);
		for (let e of t) e instanceof HTMLInputElement && (e.type === "radio" || e.type === "checkbox") && s.includes(e.value) && e.closest("label")?.classList.add(Ac);
		let c = Mc(o), l = Bc(i, r, a, c, n, t);
		l && (c ? o.after(l) : (o.closest(".formdown-field") ?? o.parentElement ?? o).append(l));
	}
	zc(e), r !== null && Gc(e, r);
}
function Uc(e) {
	let t = e.getRootNode?.();
	return t && "activeElement" in t ? t : null;
}
function Wc(e) {
	let t = Uc(e)?.activeElement;
	return !t || !e.contains(t) ? null : t.closest(`[${Ec}]`)?.getAttribute(Ec) ?? null;
}
function Gc(e, t) {
	let n = Uc(e)?.activeElement;
	if (n && e.contains(n)) return;
	let r = Kc(e, t);
	r && Zc(r);
}
function Kc(e, t) {
	let n = jc(e, t), r = n.find((e) => e instanceof HTMLInputElement && e.checked) ?? n[0];
	return (r && tl(r)) ?? r;
}
function qc(e) {
	return e.closest("[hidden]") || e instanceof HTMLInputElement && e.type === "hidden" || "disabled" in e && e.disabled || oc(e) && e.hasAttribute("disabled") ? !1 : !Mc(e) || e.getAttribute("contenteditable") !== "false";
}
var Jc = /* @__PURE__ */ new WeakSet();
function Yc(e) {
	if (e.isContentEditable) {
		let t = e.getRootNode().getSelection?.() ?? window.getSelection();
		if (!t) return;
		let n = document.createRange();
		n.selectNodeContents(e), n.collapse(!1), t.removeAllRanges(), t.addRange(n);
	} else if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) try {
		e.setSelectionRange(e.value.length, e.value.length);
	} catch {}
}
function Xc(e, t) {
	let n;
	if (t !== void 0) n = Kc(e, t), n && !qc(n) && (n = void 0);
	else {
		let t = Array.from(e.querySelectorAll("[name], [data-field-name]")).find(qc), r = t?.getAttribute("name") ?? t?.dataset.fieldName;
		n = r == null ? void 0 : Kc(e, r);
	}
	return n && Zc(n), !!n && Uc(e)?.activeElement === n;
}
function Zc(e) {
	Jc.add(e), e.focus(), e.getRootNode().activeElement !== e && Jc.delete(e), Yc(e);
}
var Qc = "data-formdown-filtered", $c = /* @__PURE__ */ new WeakMap(), el = 0;
function tl(e) {
	return e instanceof HTMLSelectElement ? $c.get(e)?.input : void 0;
}
function nl(e, t) {
	for (let n of Array.from(e.querySelectorAll("select"))) {
		let e = $c.get(n);
		!n.multiple && !n.hasAttribute("data-formdown-has-other") && rl(n).length > t ? cl(e ?? ol(n)) : e && sl(e);
	}
}
function rl(e) {
	return Array.from(e.options).filter((e) => !e.disabled && !e.hidden);
}
var il = (e) => e.label || e.textContent || e.value, al = (e) => e.normalize("NFC").toLocaleLowerCase();
function ol(e) {
	let t = e.ownerDocument, n = ++el, r = t.createElement("span");
	r.className = "formdown-select-filter";
	let i = t.createElement("input");
	i.type = "text", i.className = "formdown-select-filter-input", i.id = `formdown-filter-${n}`, i.setAttribute("role", "combobox"), i.setAttribute("aria-autocomplete", "list"), i.setAttribute("aria-expanded", "false"), i.autocomplete = "off", i.spellcheck = !1;
	let a = e.getAttribute("part");
	a && i.setAttribute("part", a);
	let o = t.createElement("ul");
	o.id = `formdown-filter-list-${n}`, o.className = "formdown-select-filter-list", o.setAttribute("role", "listbox"), o.hidden = !0, i.setAttribute("aria-controls", o.id);
	let s = e.id ? Array.from(e.getRootNode().querySelectorAll("label")).find((t) => t.htmlFor === e.id) : void 0;
	s && (s.id ||= `formdown-filter-label-${n}`, i.setAttribute("aria-labelledby", s.id)), e.setAttribute(Qc, "true"), e.tabIndex = -1, e.setAttribute("aria-hidden", "true"), e.before(r), r.append(i, o, e);
	let c = {
		select: e,
		wrapper: r,
		input: i,
		list: o,
		shown: [],
		active: -1
	};
	$c.set(e, c);
	let l = () => i.focus();
	return e.addEventListener("focus", l), c.off = () => e.removeEventListener("focus", l), i.addEventListener("focus", () => {
		Jc.delete(i) || setTimeout(() => i.select(), 0);
	}), i.addEventListener("click", () => o.hidden ? ul(c, "") : dl(c)), i.addEventListener("input", () => ul(c, i.value)), i.addEventListener("blur", () => {
		dl(c), i.value = ll(e);
	}), i.addEventListener("keydown", (e) => ml(c, e)), o.addEventListener("mousedown", (e) => e.preventDefault()), o.addEventListener("click", (e) => {
		let t = e.target.closest("[role=\"option\"]");
		t && pl(c, c.shown[Number(t.getAttribute("data-index"))]);
	}), c;
}
function sl(e) {
	let { select: t, wrapper: n } = e;
	e.off?.(), t.removeAttribute(Qc), t.removeAttribute("tabindex"), t.removeAttribute("aria-hidden"), n.before(t), n.remove(), $c.delete(t);
}
function cl(e) {
	let { select: t, input: n } = e;
	n.disabled = t.disabled, n.required = t.required;
	for (let e of [
		"aria-required",
		"aria-disabled",
		"aria-invalid",
		"aria-describedby"
	]) {
		let r = t.getAttribute(e);
		r === null ? n.removeAttribute(e) : n.setAttribute(e, r);
	}
	t.ownerDocument && n.getRootNode().activeElement !== n && (n.value = ll(t)), e.list.hidden || ul(e, n.value === ll(t) ? "" : n.value);
}
function ll(e) {
	let t = e.selectedIndex >= 0 ? e.options[e.selectedIndex] : void 0;
	return t ? il(t) : "";
}
function ul(e, t) {
	let { select: n, input: r, list: i } = e, a = al(t.trim());
	e.shown = rl(n).filter((e) => !a || al(il(e)).includes(a));
	let o = n.ownerDocument;
	i.replaceChildren(...e.shown.map((e, t) => {
		let n = o.createElement("li");
		return n.id = `${i.id}-${t}`, n.setAttribute("role", "option"), n.setAttribute("data-index", String(t)), n.setAttribute("aria-selected", String(e.selected)), n.textContent = il(e), n;
	})), i.hidden = e.shown.length === 0, r.setAttribute("aria-expanded", String(!i.hidden));
	let s = e.shown.findIndex((e) => e.selected);
	fl(e, a ? e.shown.length ? 0 : -1 : s);
}
function dl(e) {
	e.list.hidden = !0, e.list.replaceChildren(), e.shown = [], e.active = -1, e.input.setAttribute("aria-expanded", "false"), e.input.removeAttribute("aria-activedescendant");
}
function fl(e, t) {
	let n = e.list.children;
	if (e.active >= 0 && n[e.active]?.classList.remove("active"), e.active = t, t < 0) {
		e.input.removeAttribute("aria-activedescendant");
		return;
	}
	let r = n[t];
	r && (r.classList.add("active"), e.input.setAttribute("aria-activedescendant", r.id), r.scrollIntoView?.({ block: "nearest" }));
}
function pl(e, t) {
	let { select: n, input: r } = e;
	if (!t) return;
	let i = n.value !== t.value;
	n.value = t.value, r.value = il(t), dl(e), i && (n.dispatchEvent(new Event("input", {
		bubbles: !0,
		composed: !0
	})), n.dispatchEvent(new Event("change", { bubbles: !0 })));
}
function ml(e, t) {
	if (t.isComposing) return;
	let n = !e.list.hidden;
	switch (t.key) {
		case "ArrowDown":
			t.preventDefault(), n ? e.shown.length && fl(e, Math.min(e.active + 1, e.shown.length - 1)) : ul(e, "");
			break;
		case "ArrowUp":
			t.preventDefault(), n ? e.shown.length && fl(e, Math.max(e.active - 1, 0)) : ul(e, "");
			break;
		case "Enter":
			n && (t.preventDefault(), t.stopImmediatePropagation(), e.active >= 0 ? pl(e, e.shown[e.active]) : dl(e));
			break;
		case "Escape":
			n && (t.preventDefault(), t.stopPropagation(), dl(e)), e.input.value = ll(e.select), e.input.select();
			break;
		case "Tab": n && dl(e);
	}
}
function hl(e, t, n) {
	for (let [r, i] of Object.entries(t)) {
		if (!i.conditions) continue;
		let t = Bs(i.conditions, n), a = Array.from(e.querySelectorAll("input, select, textarea, [data-field-name]")).concat(sc(e)).filter((e) => (e.getAttribute("name") ?? e.getAttribute("data-field-name")) === r);
		for (let e of a) {
			let n = e.closest(".formdown-field") ?? e;
			n.hidden = !t.visible;
			let r = !!i.required || t.required;
			e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement ? (e.disabled = !t.enabled, e instanceof HTMLInputElement && (e.type === "radio" || e.type === "checkbox") || (e.required = r)) : oc(e) ? dc(e, t.enabled, r) : e.setAttribute("contenteditable", t.enabled ? "true" : "false"), e.setAttribute("aria-disabled", String(!t.enabled)), e.setAttribute("aria-required", String(r));
		}
	}
}
function gl(e) {
	let t = /* @__PURE__ */ new Map();
	for (let [n, r] of Object.entries(e ?? {})) {
		if (!r.compute) continue;
		let e = Ht(r.compute);
		!("error" in e) && !e.fields.includes(n) && t.set(n, e);
	}
	return t;
}
function _l(e, t) {
	let n = { ...t }, r = {};
	for (let [t, i] of e) {
		let e = i.evaluate(n), a = e === void 0 ? "" : String(e);
		String(n[t] ?? "") !== a && (r[t] = a), n[t] = a;
	}
	return r;
}
var vl = m`
  :host {
    display: block;
    font-family: var(--formdown-font-family, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    line-height: var(--formdown-line-height, 1.5);
    color: var(--formdown-text-primary, #1f2937);
    background: var(--formdown-bg-primary, #ffffff);
    max-width: 100%;
    box-sizing: border-box;
    overflow-y: auto;
  }

  * {
    box-sizing: border-box;
  }

  /* ========================================
   * Form Container
   * ======================================== */
  .formdown-form {
    max-width: 100%;
    width: 100%;
    margin: 0;
    padding: 0;
    display: none; /* Hidden form for form attribute reference */
  }

  /* ========================================
   * Field Layout
   * ======================================== */
  .formdown-field {
    margin-bottom: var(--formdown-field-gap, 1.5rem);
    max-width: 100%;
  }

  .formdown-field-container {
    margin-bottom: var(--formdown-spacing-md, 1rem);
  }

  .formdown-field-container:last-child {
    margin-bottom: 0;
  }

  /* ========================================
   * Labels
   * ======================================== */
  label {
    display: block;
    margin-bottom: var(--formdown-label-margin, 0.5rem);
    font-weight: var(--formdown-font-weight-medium, 500);
    color: var(--formdown-text-primary, #1f2937);
    font-size: var(--formdown-font-size-sm, 0.875rem);
    line-height: 1.25;
  }

  /* ========================================
   * Input Elements
   * ======================================== */
  input, textarea, select {
    width: 100%;
    max-width: 100%;
    padding: var(--formdown-input-padding-y, 0.75rem) var(--formdown-input-padding-x, 0.75rem);
    border: var(--formdown-input-border-width, 1px) solid var(--formdown-border-color, #e2e8f0);
    border-radius: var(--formdown-input-border-radius, 0.5rem);
    font-size: var(--formdown-font-size-base, 1rem);
    font-family: inherit;
    line-height: var(--formdown-line-height, 1.5);
    transition: all var(--formdown-transition-fast, 0.15s ease-in-out);
    background-color: var(--formdown-bg-primary, #ffffff);
    color: var(--formdown-text-primary, #1f2937);
  }

  input::placeholder, textarea::placeholder {
    color: var(--formdown-text-secondary, #64748b);
    font-style: italic;
    opacity: 0.8;
  }

  input:focus, textarea:focus, select:focus {
    outline: none;
    border-color: var(--formdown-accent-color, #3b82f6);
    box-shadow: var(--formdown-input-focus-ring, 0 0 0 var(--formdown-input-focus-ring-width, 3px) var(--formdown-input-focus-ring-color, rgba(59, 130, 246, 0.1)));
    background-color: var(--formdown-bg-primary, #ffffff);
  }

  input:hover, textarea:hover, select:hover {
    border-color: var(--formdown-text-secondary, #64748b);
  }

  input[type="radio"], input[type="checkbox"] {
    accent-color: var(--formdown-accent-color, #3b82f6);
    width: auto;
    max-width: none;
    margin-right: var(--formdown-spacing-sm, 0.5rem);
    margin-bottom: 0;
  }

  /* A switch (c[switch]): drawn the same in every browser, whether or not it draws the HTML switch itself */
  input[type="checkbox"][role="switch"] {
    appearance: none;
    position: relative;
    flex-shrink: 0;
    width: 2.25em;
    height: 1.25em;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: var(--formdown-switch-off-color, var(--formdown-border-color, #cbd5e1));
    cursor: pointer;
    transition: background-color 0.15s;
  }

  input[type="checkbox"][role="switch"]::before {
    content: "";
    position: absolute;
    top: 0.125em;
    left: 0.125em;
    width: 1em;
    height: 1em;
    border-radius: 50%;
    background: var(--formdown-switch-knob-color, #ffffff);
    transition: transform 0.15s;
  }

  input[type="checkbox"][role="switch"]:checked {
    background: var(--formdown-switch-on-color, var(--formdown-accent-color, #3b82f6));
  }

  input[type="checkbox"][role="switch"]:checked::before {
    transform: translateX(1em);
  }

  input[type="checkbox"][role="switch"]:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  @media (prefers-reduced-motion: reduce) {
    input[type="checkbox"][role="switch"], input[type="checkbox"][role="switch"]::before { transition: none; }
  }

  textarea {
    min-height: 6rem;
    resize: vertical;
  }

  select {
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e");
    background-position: right 0.5rem center;
    background-repeat: no-repeat;
    background-size: 1.5em 1.5em;
    padding-right: 2.5rem;
  }

  /* A long select, narrowed by typing (select-filter.ts): the select stays in place as the field, unseen. */
  .formdown-select-filter {
    position: relative;
    display: block;
  }

  select[data-formdown-filtered] {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
  }

  .formdown-select-filter-input {
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e");
    background-position: right 0.5rem center;
    background-repeat: no-repeat;
    background-size: 1.5em 1.5em;
    padding-right: 2.5rem;
  }

  .formdown-select-filter-list {
    position: absolute;
    z-index: 10;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    max-height: 16rem;
    overflow-y: auto;
    margin: 0;
    padding: 0.25rem 0;
    list-style: none;
    background-color: var(--formdown-bg-primary, #ffffff);
    color: var(--formdown-text-primary, #1f2937);
    border: var(--formdown-input-border-width, 1px) solid var(--formdown-border-color, #e2e8f0);
    border-radius: var(--formdown-input-border-radius, 0.5rem);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }

  .formdown-select-filter-list[hidden] {
    display: none;
  }

  .formdown-select-filter-list [role="option"] {
    padding: 0.375rem var(--formdown-input-padding-x, 0.75rem);
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .formdown-select-filter-list [role="option"][aria-selected="true"] {
    font-weight: 600;
  }

  .formdown-select-filter-list [role="option"].active,
  .formdown-select-filter-list [role="option"]:hover {
    background-color: var(--formdown-accent-color, #3b82f6);
    color: var(--formdown-bg-primary, #ffffff);
  }

  /* ========================================
   * Fieldset/Section
   * ======================================== */
  fieldset {
    border: var(--formdown-section-border-width, 1px) solid var(--formdown-section-border-color, var(--formdown-border-color, #e2e8f0));
    border-radius: var(--formdown-section-border-radius, 0.5rem);
    padding: var(--formdown-section-padding, 1.25rem);
    margin: 0 0 var(--formdown-field-gap, 1.5rem) 0;
    max-width: 100%;
    background-color: var(--formdown-section-bg, var(--formdown-bg-primary, #ffffff));
  }

  legend {
    font-weight: var(--formdown-font-weight-semibold, 600);
    color: var(--formdown-text-primary, #1f2937);
    padding: 0 var(--formdown-spacing-md, 1rem);
    font-size: var(--formdown-font-size-sm, 0.875rem);
  }

  fieldset label {
    display: flex;
    align-items: center;
    margin-bottom: var(--formdown-spacing-md, 1rem);
    font-weight: var(--formdown-font-weight-normal, 400);
    font-size: var(--formdown-font-size-sm, 0.875rem);
  }

  /* ========================================
   * Inline Fields (contentEditable)
   * ======================================== */
  formdown-field,
  [contenteditable="true"]:not(textarea) {
    display: inline-block;
    box-sizing: border-box;
    min-width: 60px;
    /* Grow with the value; only a value wider than the line is cut short. */
    max-width: 100%;
    font-style: normal;
    color: inherit;
    font-size: inherit;
    line-height: var(--formdown-line-height, 1.5);
    font-family: inherit;
    font-weight: inherit;
    cursor: text;
    outline: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
    box-decoration-break: clone;
  }

  [contenteditable="true"]:not(textarea):empty::before {
    content: attr(data-placeholder);
    color: var(--formdown-text-secondary, #64748b);
    font-style: italic;
    font-weight: var(--formdown-font-weight-normal, 400);
    opacity: 0.7;
    pointer-events: none;
    user-select: none;
  }

  [contenteditable="true"]:not(textarea) {
    border: 1px solid var(--formdown-border-color, #e2e8f0);
    background-color: var(--formdown-bg-secondary, #f8fafc);
    border-radius: 0.25rem;
    padding: 0.125rem 0.5rem;
    transition: all var(--formdown-transition-normal, 0.2s ease-in-out);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
    position: relative;
    min-height: 1.5em;
  }

  [contenteditable="true"]:not(textarea):hover {
    background-color: var(--formdown-bg-secondary, #f8fafc);
    border-color: var(--formdown-text-secondary, #64748b);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), inset 0 1px 2px rgba(0, 0, 0, 0.05);
    transform: translateY(-1px);
  }

  [contenteditable="true"]:not(textarea):focus {
    background-color: var(--formdown-bg-primary, #ffffff);
    border-color: var(--formdown-accent-color, #3b82f6);
    box-shadow: var(--formdown-input-focus-ring, 0 0 0 var(--formdown-input-focus-ring-width, 3px) var(--formdown-input-focus-ring-color, rgba(59, 130, 246, 0.1)));
    color: var(--formdown-text-primary, #1f2937);
    transform: translateY(-1px);
  }

  [contenteditable="true"]:not(textarea):not(:empty) {
    background-color: var(--formdown-bg-primary, #ffffff);
    border-color: var(--formdown-border-color, #e2e8f0);
    font-weight: var(--formdown-font-weight-normal, 400);
  }

  /* ========================================
   * Field states (fieldStates): offered values and notes
   * ======================================== */
  .formdown-ghost::placeholder,
  [contenteditable="true"].formdown-ghost:empty::before {
    color: var(--formdown-ghost-color, var(--formdown-text-secondary, #64748b));
    font-style: normal;
  }

  /* How to fill a field, under it: quiet, like a note. */
  .formdown-field-description {
    margin-top: var(--formdown-spacing-xs, 0.25rem);
    font-size: var(--formdown-font-size-sm, 0.875rem);
    color: var(--formdown-description-color, var(--formdown-text-secondary, #64748b));
  }

  .formdown-field-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--formdown-spacing-xs, 0.25rem);
    margin-top: var(--formdown-spacing-xs, 0.25rem);
    font-size: var(--formdown-font-size-sm, 0.875rem);
    color: var(--formdown-note-color, var(--formdown-text-secondary, #64748b));
  }

  span.formdown-field-note {
    display: inline-flex;
    margin: 0 0 0 var(--formdown-spacing-sm, 0.5rem);
    vertical-align: middle;
  }

  /* Plain chips, clear of the form's button styling. */
  .formdown-field-note button.formdown-suggestion {
    margin: 0;
    padding: 0 var(--formdown-spacing-sm, 0.5rem);
    border: 1px dashed var(--formdown-suggestion-border-color, var(--formdown-accent-color, #3b82f6));
    border-radius: var(--formdown-input-border-radius, 0.5rem);
    background: var(--formdown-suggestion-bg, transparent);
    box-shadow: none;
    color: var(--formdown-text-primary, #1f2937);
    font-size: inherit;
    font-weight: var(--formdown-font-weight-normal, 400);
    letter-spacing: normal;
    line-height: var(--formdown-line-height, 1.5);
    transform: none;
  }

  .formdown-field-note button.formdown-suggestion::before {
    display: none;
  }

  .formdown-field-note button.formdown-suggestion:hover {
    background: var(--formdown-bg-secondary, #f8fafc);
    transform: none;
  }

  .formdown-field-note button.formdown-suggestion:focus-visible {
    outline: 2px solid var(--formdown-accent-color, #3b82f6);
    outline-offset: 1px;
  }

  /* A quiet text button: declining is not the offered action. */
  .formdown-field-note button.formdown-decline {
    margin: 0;
    padding: 0 var(--formdown-spacing-xs, 0.25rem);
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--formdown-note-color, var(--formdown-text-secondary, #64748b));
    font-size: inherit;
    font-weight: var(--formdown-font-weight-normal, 400);
    letter-spacing: normal;
    line-height: var(--formdown-line-height, 1.5);
    text-decoration: underline;
    transform: none;
  }

  .formdown-field-note button.formdown-decline::before {
    display: none;
  }

  .formdown-field-note button.formdown-decline:hover {
    color: var(--formdown-text-primary, #1f2937);
    background: transparent;
    transform: none;
  }

  .formdown-field-note button.formdown-decline:focus-visible {
    outline: 2px solid var(--formdown-accent-color, #3b82f6);
    outline-offset: 1px;
  }

  label.formdown-suggested {
    outline: 1px dashed var(--formdown-suggestion-border-color, var(--formdown-accent-color, #3b82f6));
    outline-offset: 2px;
    border-radius: var(--formdown-input-border-radius, 0.5rem);
  }

  /* ========================================
   * Typography (Markdown Content)
   * ======================================== */
  h1, h2, h3, h4, h5, h6 {
    margin-top: 0;
    margin-bottom: var(--formdown-spacing-md, 1rem);
    color: var(--formdown-text-primary, #1f2937);
    font-weight: var(--formdown-font-weight-semibold, 600);
    line-height: 1.25;
  }

  h1 { font-size: 2.25rem; font-weight: var(--formdown-font-weight-bold, 700); }
  h2 { font-size: 1.875rem; }
  h3 { font-size: 1.5rem; }
  h4 { font-size: 1.25rem; }
  h5 { font-size: 1.125rem; }
  h6 { font-size: 1rem; }

  p {
    margin-bottom: var(--formdown-spacing-md, 1rem);
    line-height: 1.7;
    color: var(--formdown-text-secondary, #64748b);
  }

  /* ========================================
   * Code Blocks
   * ======================================== */
  pre {
    background-color: var(--formdown-code-bg, var(--formdown-bg-secondary, #f8fafc));
    border: 1px solid var(--formdown-border-color, #e2e8f0);
    border-radius: var(--formdown-code-border-radius, 0.375rem);
    padding: var(--formdown-spacing-md, 1rem);
    margin: var(--formdown-spacing-md, 1rem) 0;
    overflow-x: auto;
    font-family: var(--formdown-code-font-family, 'Monaco', 'Menlo', 'Ubuntu Mono', monospace);
    font-size: var(--formdown-font-size-sm, 0.875rem);
    line-height: 1.6;
  }

  code {
    font-family: var(--formdown-code-font-family, 'Monaco', 'Menlo', 'Ubuntu Mono', monospace);
    font-size: var(--formdown-code-font-size, 0.875em);
    background-color: rgba(175, 184, 193, 0.2);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    color: var(--formdown-text-primary, #1f2937);
  }

  pre code {
    background-color: transparent;
    padding: 0;
    border-radius: 0;
    font-size: var(--formdown-font-size-sm, 0.875rem);
    color: var(--formdown-text-primary, #1f2937);
  }

  .language-javascript, .language-js,
  .language-typescript, .language-ts,
  .language-python, .language-py,
  .language-html, .language-css,
  .language-json, .language-bash {
    display: block;
  }

  /* ========================================
   * Responsive Design
   * ======================================== */
  @media (max-width: 768px) {
    :host {
      font-size: var(--formdown-font-size-sm, 0.875rem);
    }

    input, textarea, select {
      padding: 0.625rem;
      font-size: var(--formdown-font-size-sm, 0.875rem);
    }

    h1 { font-size: 1.875rem; }
    h2 { font-size: 1.5rem; }
    h3 { font-size: 1.25rem; }
  }

  /* ========================================
   * Validation States
   * ======================================== */
  .error {
    color: var(--formdown-error-color, #ef4444);
    font-size: var(--formdown-font-size-sm, 0.875rem);
    margin-top: var(--formdown-spacing-sm, 0.5rem);
    display: block;
  }

  .field-error {
    border-color: var(--formdown-error-color, #ef4444) !important;
    box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.1) !important;
  }

  .field-error:focus {
    border-color: var(--formdown-error-color, #ef4444) !important;
    box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1) !important;
  }

  .validation-error-message {
    color: var(--formdown-error-color, #ef4444);
    font-size: var(--formdown-font-size-xs, 0.75rem);
    margin-top: var(--formdown-spacing-xs, 0.25rem);
    display: block;
    font-weight: var(--formdown-font-weight-medium, 500);
    white-space: pre-line;
  }

  /* Beside an inline field, the sentence stays in the line. */
  span.validation-error-message {
    display: inline;
    margin: 0 0 0 var(--formdown-spacing-xs, 0.25rem);
  }

  .field-valid {
    border-color: var(--formdown-success-color, #10b981) !important;
    box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.1) !important;
  }

  /* ========================================
   * Buttons - Base Styles
   * ======================================== */
  .submit-button,
  button,
  input[type="submit"],
  input[type="button"],
  input[type="reset"] {
    color: var(--formdown-button-text, #ffffff);
    padding: var(--formdown-button-padding-y, 0.75rem) var(--formdown-button-padding-x, 1.75rem);
    border: none;
    border-radius: var(--formdown-button-border-radius, 0.5rem);
    font-size: var(--formdown-font-size-base, 1rem);
    font-weight: var(--formdown-button-font-weight, 600);
    cursor: pointer;
    transition: all var(--formdown-transition-normal, 0.2s ease-in-out);
    margin-top: var(--formdown-field-gap, 1.5rem);
    width: auto;
    max-width: 100%;
    letter-spacing: 0.025em;
    position: relative;
    overflow: hidden;
    font-family: inherit;
  }

  /* Shine effect */
  .submit-button::before,
  button::before,
  input[type="submit"]::before,
  input[type="button"]::before,
  input[type="reset"]::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    transition: left 0.5s ease-in-out;
  }

  .submit-button:hover::before,
  button:hover::before,
  input[type="submit"]:hover::before,
  input[type="button"]:hover::before,
  input[type="reset"]:hover::before {
    left: 100%;
  }

  .submit-button:hover,
  button:hover,
  input[type="submit"]:hover,
  input[type="button"]:hover,
  input[type="reset"]:hover {
    transform: translateY(-2px);
  }

  .submit-button:active,
  button:active,
  input[type="submit"]:active,
  input[type="button"]:active,
  input[type="reset"]:active {
    transform: translateY(0);
  }

  .submit-button:disabled,
  button:disabled,
  input[type="submit"]:disabled,
  input[type="button"]:disabled,
  input[type="reset"]:disabled {
    background: linear-gradient(135deg, #9ca3af 0%, #6b7280 100%);
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
    opacity: 0.6;
  }

  .submit-button:disabled::before,
  button:disabled::before,
  input[type="submit"]:disabled::before,
  input[type="button"]:disabled::before,
  input[type="reset"]:disabled::before {
    display: none;
  }

  /* Primary Button (submit) */
  .submit-button,
  button[type="submit"],
  input[type="submit"],
  button:not([type]) {
    background: var(--formdown-button-bg, linear-gradient(135deg, #3b82f6 0%, #2563eb 100%));
    box-shadow: var(--formdown-button-shadow, 0 2px 4px rgba(59, 130, 246, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05));
  }

  .submit-button:hover,
  button[type="submit"]:hover,
  input[type="submit"]:hover,
  button:not([type]):hover {
    background: var(--formdown-button-bg-hover, linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%));
    box-shadow: var(--formdown-button-shadow-hover, 0 6px 12px rgba(59, 130, 246, 0.3), 0 2px 4px rgba(0, 0, 0, 0.1));
  }

  .submit-button:active,
  button[type="submit"]:active,
  input[type="submit"]:active,
  button:not([type]):active {
    box-shadow: var(--formdown-button-shadow, 0 2px 4px rgba(59, 130, 246, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05));
  }

  /* Secondary Button */
  button[type="button"],
  input[type="button"] {
    background: var(--formdown-button-secondary-bg, linear-gradient(135deg, #64748b 0%, #475569 100%));
    box-shadow: 0 2px 4px rgba(100, 116, 139, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  button[type="button"]:hover,
  input[type="button"]:hover {
    background: var(--formdown-button-secondary-bg-hover, linear-gradient(135deg, #475569 0%, #334155 100%));
    box-shadow: 0 6px 12px rgba(100, 116, 139, 0.3), 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  button[type="button"]:active,
  input[type="button"]:active {
    box-shadow: 0 2px 4px rgba(100, 116, 139, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  /* Danger Button (reset) */
  button[type="reset"],
  input[type="reset"] {
    background: var(--formdown-button-danger-bg, linear-gradient(135deg, #ef4444 0%, #dc2626 100%));
    box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  button[type="reset"]:hover,
  input[type="reset"]:hover {
    background: var(--formdown-button-danger-bg-hover, linear-gradient(135deg, #dc2626 0%, #b91c1c 100%));
    box-shadow: 0 6px 12px rgba(239, 68, 68, 0.3), 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  button[type="reset"]:active,
  input[type="reset"]:active {
    box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  /* ========================================
   * Content Container
   * ======================================== */
  #content-container {
    max-width: 100%;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }

  /* ========================================
   * Radio and Checkbox Groups
   * ======================================== */
  .radio-group, .checkbox-group {
    display: flex;
    gap: var(--formdown-spacing-md, 1rem);
    flex-wrap: wrap;
  }

  .radio-group.inline, .checkbox-group.inline {
    flex-direction: row;
    align-items: center;
  }

  .radio-group.vertical, .checkbox-group.vertical {
    flex-direction: column;
    align-items: flex-start;
  }

  .formdown-option-label {
    display: flex;
    align-items: center;
    margin-bottom: 0;
    font-weight: var(--formdown-font-weight-normal, 400);
    cursor: pointer;
    font-size: var(--formdown-font-size-sm, 0.875rem);
    white-space: nowrap;
  }

  /* A label a person presses to tick or pick is a target of at least 24 by 24 px (WCAG 2.2 SC 2.5.8). The
     row has the height, not the input: sizing a checkbox or radio would redraw its glyph. */
  .formdown-option-label, .formdown-checkbox-label {
    min-block-size: 24px;
  }

  .formdown-checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--formdown-spacing-sm, 0.5rem);
  }

  .formdown-option-label input {
    margin-right: var(--formdown-spacing-sm, 0.5rem);
    margin-bottom: 0;
  }

  .formdown-option-label span {
    user-select: none;
  }

  /* A value from the data the field could not take (unread.ts): shown as written, beside the empty field. */
  .formdown-unread {
    margin-left: var(--formdown-spacing-sm, 0.5rem);
    color: var(--formdown-text-primary, #1f2937);
    text-decoration: underline dashed var(--formdown-warning-color, #f59e0b);
    text-underline-offset: 0.2em;
    font-size: var(--formdown-font-size-sm, 0.875rem);
    white-space: pre-wrap;
  }

  .radio-group label, .checkbox-group label {
    display: flex;
    align-items: center;
    margin-bottom: 0;
    font-weight: var(--formdown-font-weight-normal, 400);
    cursor: pointer;
  }

  .formdown-form > * + * {
    margin-top: var(--formdown-spacing-md, 1rem);
  }

  /* ========================================
   * Table Styles (GitHub Flavored Markdown)
   * ======================================== */
  .formdown-table {
    width: 100%;
    border-collapse: collapse;
    margin: var(--formdown-table-margin, 1rem 0);
    background-color: var(--formdown-table-bg, var(--formdown-bg-primary, #ffffff));
    border: var(--formdown-table-border-width, 1px) solid var(--formdown-table-border-color, var(--formdown-border-color, #e2e8f0));
    border-radius: var(--formdown-table-border-radius, 6px);
    overflow: hidden;
    font-size: var(--formdown-table-font-size, 0.875rem);
  }

  .formdown-table thead {
    background-color: var(--formdown-table-header-bg, var(--formdown-bg-secondary, #f8fafc));
    border-bottom: var(--formdown-table-border-width, 1px) solid var(--formdown-table-border-color, var(--formdown-border-color, #e2e8f0));
  }

  .formdown-table th {
    padding: var(--formdown-table-cell-padding, 0.5rem 1rem);
    text-align: left;
    font-weight: var(--formdown-table-header-weight, 600);
    font-size: inherit;
    color: var(--formdown-table-header-color, var(--formdown-text-primary, #1f2937));
    border-right: var(--formdown-table-border-width, 1px) solid var(--formdown-table-border-color, var(--formdown-border-color, #e2e8f0));
  }

  .formdown-table th:last-child {
    border-right: none;
  }

  .formdown-table td {
    padding: var(--formdown-table-cell-padding, 0.5rem 1rem);
    border-top: var(--formdown-table-border-width, 1px) solid var(--formdown-table-border-color, var(--formdown-border-color, #e2e8f0));
    border-right: var(--formdown-table-border-width, 1px) solid var(--formdown-table-border-color, var(--formdown-border-color, #e2e8f0));
    color: var(--formdown-text-secondary, #64748b);
    line-height: var(--formdown-line-height, 1.5);
  }

  .formdown-table td:last-child {
    border-right: none;
  }

  .formdown-table tbody tr {
    transition: background-color var(--formdown-transition-fast, 0.15s ease-in-out);
  }

  .formdown-table tbody tr:hover {
    background-color: var(--formdown-table-row-hover-bg, var(--formdown-bg-secondary, #f8fafc));
  }

  .formdown-table tbody tr:last-child td {
    border-bottom: none;
  }

  .formdown-table td [contenteditable="true"] {
    min-width: 80px;
    max-width: 100%;
    display: inline-block;
  }

  @media (max-width: 768px) {
    .formdown-table {
      font-size: 0.8125rem;
      border-radius: 4px;
    }

    .formdown-table th,
    .formdown-table td {
      padding: 0.375rem 0.75rem;
    }
  }
`;
function yl(e) {
	let t = [...new Set(Object.values(e ?? {}).map((e) => e.type))];
	return j().getFieldTypeRegistry().getStylesForTypes(t);
}
var bl = class {
	constructor(e) {
		this.css = "", this.root = e;
	}
	set(e) {
		if (e !== this.css) {
			if (this.css = e, this.adoptable()) {
				this.sheet || (this.sheet = new CSSStyleSheet(), this.root.adoptedStyleSheets = [...this.root.adoptedStyleSheets, this.sheet]), this.sheet.replaceSync(e);
				return;
			}
			this.element || (this.element = document.createElement("style"), this.element.setAttribute("data-formdown-field-types", ""), this.root.appendChild(this.element)), this.element.textContent = e;
		}
	}
	adoptable() {
		return "adoptedStyleSheets" in this.root && typeof CSSStyleSheet < "u" && "replaceSync" in CSSStyleSheet.prototype;
	}
}, xl = "data-formdown-error-for", Sl = "data-formdown-described-by", Cl = "field-error";
function wl(e, t) {
	let n = Array.from(e.querySelectorAll("[name]")).filter((e) => e.getAttribute("name") === t);
	if (n.length > 0) return n;
	let r = Array.from(e.querySelectorAll("[data-field-name]")).find((e) => e.dataset.fieldName === t);
	return r ? [r] : [];
}
function Tl(e) {
	return e.isContentEditable || e.getAttribute("contenteditable") === "true";
}
function El(e) {
	let t = /* @__PURE__ */ new Map();
	for (let { field: n, message: r } of e) {
		let e = t.get(n) ?? [];
		e.includes(r) || e.push(r), t.set(n, e);
	}
	return t;
}
function Dl(e, t) {
	for (let n of Array.from(e.querySelectorAll(`[${xl}]`))) (t === void 0 || n.getAttribute(xl) === t) && n.remove();
	let n = Array.from(e.querySelectorAll(`[${Sl}]`));
	for (let e of n) {
		if (t !== void 0 && (e.getAttribute("name") ?? e.dataset.fieldName) !== t) continue;
		let n = e.getAttribute(Sl);
		n ? e.setAttribute("aria-describedby", n) : e.removeAttribute("aria-describedby"), e.removeAttribute(Sl), e.removeAttribute("aria-invalid"), e.classList.remove(Cl), e.classList.length === 0 && e.removeAttribute("class");
	}
}
function Ol(e, t, n) {
	Dl(e, t);
	let r = wl(e, t), i = r[0];
	if (!i || n.length === 0) return;
	let a = Tl(i), o = i.ownerDocument.createElement(a ? "span" : "div");
	o.className = "validation-error-message", o.setAttribute("part", "field-error"), o.setAttribute(xl, t), o.id = `${i.id || `formdown-${t}`}-validation`, o.textContent = n.join("\n");
	for (let e of r) e.setAttribute(Sl, e.getAttribute("aria-describedby") ?? ""), e.setAttribute("aria-describedby", [e.getAttribute("aria-describedby"), o.id].filter(Boolean).join(" ")), e.setAttribute("aria-invalid", "true"), e.classList.add(Cl);
	a ? i.after(o) : (i.closest(".formdown-field") ?? i.parentElement ?? i).append(o);
}
function kl(e, t) {
	Dl(e);
	for (let [n, r] of t) Ol(e, n, r);
}
function Al(e, t, n, r) {
	var i = arguments.length, a = i < 3 ? t : r === null ? r = Object.getOwnPropertyDescriptor(t, n) : r, o;
	if (typeof Reflect == "object" && typeof Reflect.decorate == "function") a = Reflect.decorate(e, t, n, r);
	else for (var s = e.length - 1; s >= 0; s--) (o = e[s]) && (a = (i < 3 ? o(a) : i > 3 ? o(t, n, a) : o(t, n)) || a);
	return i > 3 && a && Object.defineProperty(t, n, a), a;
}
var jl = class extends We {
	static {
		this.styles = vl;
	}
	get data() {
		return this._data;
	}
	set data(e) {
		if (this._isUpdatingUI) return;
		let t = this._data;
		this._data = typeof e == "object" && e ? { ...e } : {}, this.requestUpdate("data", t), this.formManager && this._schema && !this._isUpdatingUI && this.formManager.updateData(this._data);
	}
	updateData(e) {
		this.data = e, this.formManager && this._schema && this.formManager.updateData(e);
	}
	focusField(e) {
		let t = this.shadowRoot?.querySelector("#content-container");
		return t ? Xc(t, e) : !1;
	}
	updateField(e, t) {
		this.data = {
			...this.data,
			[e]: t
		}, this.formManager && this._schema && this.formManager.setFieldValue(e, t);
	}
	async scheduleUpdate() {
		await this.extensionsReady, super.scheduleUpdate();
	}
	constructor() {
		super(), this.content = "", this.bodyHtml = "trust", this.fieldStates = {}, this.choices = {}, this.filterSelectAbove = 20, this.messages = {}, this.shownErrors = /* @__PURE__ */ new Set(), this._data = {}, this.fieldRegistry = /* @__PURE__ */ new Map(), this._isUpdatingUI = !1, this._schema = null, this.computed = /* @__PURE__ */ new Map(), this.formManager = new ic(), this.domBinder = this.formManager.createDOMBinder(), this.setupCoreUIBridge(), this.setupFormManagerEvents();
	}
	setupCoreUIBridge() {
		this.formManager.setupComponentBridge({
			id: "formdown-ui",
			type: "ui",
			emit: (e, t) => this.dispatchEvent(new CustomEvent(e, {
				detail: t,
				bubbles: !0
			})),
			on: (e, t) => () => {}
		});
	}
	setupFormManagerEvents() {
		this.formManager.on("data-change", ({ formData: e }) => {
			this._isUpdatingUI ||= (this._isUpdatingUI = !0, this.data = e, !1);
		}), this.formManager.on("validation-error", ({ field: e, errors: t }) => {
			this.dispatchEvent(new CustomEvent("validation-error", {
				detail: {
					field: e,
					errors: t
				},
				bubbles: !0
			}));
		}), this.formManager.on("form-submit", ({ formData: e }) => {
			this.dispatchEvent(new CustomEvent("form-submit", {
				detail: { formData: e },
				bubbles: !0
			}));
		});
	}
	validate() {
		if (!this.formManager || !this._schema) return {
			isValid: !0,
			errors: []
		};
		let e = this.formManager.validate({ messages: this.messages }), t = El(e.errors), n = this.shadowRoot?.querySelector("#content-container");
		return n && kl(n, t), this.shownErrors = new Set(t.keys()), e;
	}
	recheckShownErrors() {
		if (this.shownErrors.size === 0 || !this._schema) return;
		let e = this.shadowRoot?.querySelector("#content-container");
		if (!e) return;
		let t = El(Qs(this.formManager.getData(), this._schema, { messages: this.messages }).errors), n = new Map([...t].filter(([e]) => this.shownErrors.has(e)));
		kl(e, n), this.shownErrors = new Set(n.keys());
	}
	getSchema() {
		return this._schema;
	}
	reset() {
		this.formManager && this._schema && (this.formManager.reset(), this.data = this.formManager.getData());
	}
	isDirty() {
		return !this.formManager || !this._schema ? !1 : this.formManager.isDirty();
	}
	connectedCallback() {
		this.extensionsReady ??= Bt().catch(() => void 0), super.connectedCallback(), !this.content && this.textContent?.trim() && (this.content = this.textContent.trim(), this.textContent = "");
	}
	render() {
		if (!this.content || !this.content.trim()) return Ee`<div class="error">No Formdown content provided</div>`;
		try {
			this.formManager.parse(this.content), this._schema = this.formManager.getSchema(), this.computed = gl(this._schema), this.data && Object.keys(this.data).length > 0 && this.formManager.updateData(this.data);
			let e = this.formManager.renderToTemplate({
				container: this,
				html: this.bodyHtml
			});
			return !e.html || !e.html.trim() ? Ee`<div class="error">Generated HTML is empty</div>` : Ee`<div id="content-container"></div>`;
		} catch (e) {
			return Ee`<div class="error">Error rendering content: ${e instanceof Error ? e.message : String(e)}</div>`;
		}
	}
	firstUpdated() {
		this.updateContent(), this.drawFieldStates(), setTimeout(() => {
			this.syncUIFromData();
		}, 0);
	}
	updated(e) {
		if (super.updated(e), (e.has("content") || e.has("bodyHtml")) && (this.updateContent(), this.drawFieldStates(), setTimeout(() => {
			this.syncUIFromData();
		}, 0)), e.has("data") && this.syncUIFromData(), (e.has("data") || e.has("messages")) && !e.has("content") && this.recheckShownErrors(), e.has("fieldStates") && !e.has("content") && this.drawFieldStates(), e.has("choices") && !e.has("content") && !e.has("data") && this.syncUIFromData(), e.has("filterSelectAbove") && !e.has("content")) {
			let e = this.shadowRoot?.querySelector("#content-container");
			e && nl(e, this.filterSelectAbove);
		}
	}
	drawFieldStates() {
		let e = this.shadowRoot?.querySelector("#content-container");
		e && Hc(e, this.fieldStates ?? {}, {
			onPick: (e, t) => this.dispatchEvent(new CustomEvent("formdown-suggestion-pick", {
				detail: {
					field: e,
					value: t
				},
				bubbles: !0,
				composed: !0
			})),
			onDecline: (e) => this.dispatchEvent(new CustomEvent("formdown-suggestion-decline", {
				detail: { field: e },
				bubbles: !0,
				composed: !0
			}))
		});
	}
	updateContent() {
		if (this.content && this.content.trim()) try {
			let e = this.shadowRoot?.querySelector("#content-container");
			if (!e) return;
			this.formManager.parse(this.content), this._schema = this.formManager.getSchema(), this.computed = gl(this._schema), this.fieldTypeSheet ??= new bl(this.shadowRoot), this.fieldTypeSheet.set(yl(this._schema)), this.data && Object.keys(this.data).length > 0 && this.formManager.updateData(this.data);
			let t = this.formManager.renderToTemplate({
				container: this,
				html: this.bodyHtml
			});
			if (!t.html || t.html.trim() === "") {
				e.innerHTML = "<div class=\"error\">FormManager returned empty HTML</div>";
				return;
			}
			e.innerHTML = t.html, this.shownErrors.clear(), this.injectExtensionAssets(e), this.setupFieldHandlers(e);
		} catch (e) {
			let t = this.shadowRoot?.querySelector("#content-container");
			t && (t.innerHTML = `<div class="error">Error: ${e instanceof Error ? e.message : String(e)}</div>`);
		}
	}
	injectExtensionAssets(e) {
		try {
			let t = /* @__PURE__ */ new Set();
			e.querySelectorAll("[data-field-type]").forEach((e) => {
				let n = e.getAttribute("data-field-type");
				n && t.add(n);
			});
		} catch {}
	}
	setupFieldHandlers(e) {
		this.fieldRegistry.clear(), e.querySelectorAll("input, textarea, select, [contenteditable=\"true\"]").forEach((e) => {
			let t = e, n = this.getFieldName(t);
			n && (this.registerField(n, t), this.setupFieldEventHandlers(t, n));
		}), this.setupCustomControls(e);
		for (let t of cc(e)) customElements.whenDefined(t).then(() => {
			e.isConnected && (this.setupCustomControls(e), this.syncUIFromData());
		});
		let t = e.querySelectorAll("input:not([type=\"radio\"]):not([type=\"checkbox\"]), [contenteditable=\"true\"]");
		this.setupBasicKeyboardNavigation(t);
	}
	setupCustomControls(e) {
		for (let t of sc(e)) {
			let e = t.getAttribute("name");
			this.fieldRegistry.get(e)?.has(t) || (this.registerField(e, t), this.setupFieldEventHandlers(t, e));
		}
	}
	setupBasicKeyboardNavigation(e) {
		e.forEach((t, n) => {
			t.addEventListener("keydown", (r) => {
				let i = r;
				if (i.key === "Enter" && t.tagName.toLowerCase() !== "textarea") {
					i.preventDefault();
					let t = n + 1;
					t < e.length && e[t].focus();
				}
			});
		});
	}
	setupFieldEventHandlers(e, t) {
		this.domBinder.bindFieldToElement(t, e);
		let n = (n) => {
			let r = this.data[t];
			this.formManager.handleUIEvent(n, this.domBinder);
			let i = this.getFieldValueFromElement(e);
			Ml(r, i) || this.updateDataReactively(t, i);
		};
		e.addEventListener("input", n), e.addEventListener("change", n), e.addEventListener("focus", (e) => {
			let t = e.target;
			Jc.delete(t) || (t.hasAttribute("contenteditable") && setTimeout(() => {
				let e = document.createRange(), n = window.getSelection();
				n && t.textContent && (e.selectNodeContents(t), n.removeAllRanges(), n.addRange(e));
			}, 0), t instanceof HTMLInputElement && t.type !== "file" && t.type !== "checkbox" && t.type !== "radio" && setTimeout(() => {
				t.select();
			}, 0));
		}), e.hasAttribute("contenteditable") && (e.addEventListener("blur", n), e.addEventListener("blur", () => {
			e.scrollLeft = 0;
		}));
	}
	updateDataReactively(e, t, n) {
		this._isUpdatingUI || (this.formManager.setFieldValue(e, t), this.data = {
			...this.data,
			[e]: t,
			...this.followComputed()
		}, this.emitFieldEvents(e, t));
	}
	followComputed() {
		let e = _l(this.computed, this.formManager.getData());
		for (let [t, n] of Object.entries(e)) this.formManager.setFieldValue(t, n);
		return e;
	}
	syncUIFromData() {
		if (!this._isUpdatingUI) {
			this._isUpdatingUI = !0;
			try {
				let e = this.shadowRoot?.activeElement, t = this.shadowRoot?.querySelector("#content-container");
				if (t) for (let e of [...wc(t, this.choices ?? {}), ...mc(t, this.data)]) this.registerField(e.name, e), this.setupFieldEventHandlers(e, e.name);
				this.domBinder.getValueAssignments(this.data).forEach(({ element: t, value: n, fieldType: r }) => {
					let i = t;
					i !== e && pc(i, n, r);
				}), t && bc(t, this.data), t && this._schema && hl(t, this._schema, this.data), t && nl(t, this.filterSelectAbove), t && zc(t);
			} finally {
				this._isUpdatingUI = !1, this.domBinder.releaseSyncLock();
			}
		}
	}
	getFieldName(e) {
		return e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement ? e.name || e.id || null : e.dataset.fieldName || e.id || null;
	}
	getFieldValueFromElement(e) {
		if (oc(e)) return lc(e);
		if (e instanceof HTMLInputElement) {
			if (e.type === "checkbox") {
				let t = e.name, n = this.formManager.createFieldProcessor().processCheckboxGroup(t, {
					querySelector: (e) => this.shadowRoot?.querySelector(e),
					querySelectorAll: (e) => Array.from(this.shadowRoot?.querySelectorAll(e) || [])
				});
				return n.success ? n.value : e.checked;
			}
			return e.type, e.value;
		}
		return e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement ? e.value : e.hasAttribute("contenteditable") && e.textContent?.trim() || "";
	}
	registerField(e, t) {
		this.fieldRegistry.has(e) || this.fieldRegistry.set(e, /* @__PURE__ */ new Set()), this.fieldRegistry.get(e).add(t);
	}
	emitFieldEvents(e, t) {
		let n = this.getFormData();
		this.dispatchEvent(new CustomEvent("formdown-change", {
			detail: {
				fieldName: e,
				value: t,
				formData: n
			},
			bubbles: !0
		})), this.dispatchEvent(new CustomEvent("formdown-data-update", {
			detail: { formData: n },
			bubbles: !0
		}));
	}
	syncFieldValue(e, t) {
		this.formManager.setFieldValue(e, t), this.followComputed(), this.data = this.formManager.getData(), this.emitFieldEvents(e, t);
	}
	updateFormData(e, t) {
		this.formManager.setFieldValue(e, t), this.data = this.formManager.getData(), this.emitFieldEvents(e, t);
	}
	getFormData() {
		return this.formManager.getData();
	}
	getDefaultValues() {
		return this.formManager.getDefaultValues();
	}
	clearValidationStates() {
		let e = this.shadowRoot?.querySelector("#content-container");
		e && (Dl(e), this.shownErrors.clear());
	}
	resetForm() {
		this.formManager.reset(), this.data = this.formManager.getData(), this.clearValidationStates();
	}
	setFormData(e) {
		if (!this.formManager) return;
		let t = this.shadowRoot?.querySelector("#content-container");
		t && (Object.entries(e).forEach(([e, n]) => {
			let r = Array.from(t.querySelectorAll(`[name="${CSS.escape(e)}"]`));
			if (r.length === 0) {
				let n = t.querySelector(`[data-field-name="${CSS.escape(e)}"]`) ?? t.querySelector(`#${CSS.escape(e)}`);
				r = n ? [n] : [];
			}
			for (let e of r) pc(e, n, e instanceof HTMLInputElement ? e.type : e.dataset.fieldType ?? "text"), e.dispatchEvent(new Event("input", { bubbles: !0 }));
		}), this.data = { ...e });
	}
};
Al([O()], jl.prototype, "content", void 0), Al([O({ attribute: "body-html" })], jl.prototype, "bodyHtml", void 0), Al([O({ attribute: !1 })], jl.prototype, "fieldStates", void 0), Al([O({ attribute: !1 })], jl.prototype, "choices", void 0), Al([O({
	attribute: "filter-select-above",
	type: Number
})], jl.prototype, "filterSelectAbove", void 0), Al([O({ attribute: !1 })], jl.prototype, "messages", void 0), Al([O({ type: Object })], jl.prototype, "data", null), jl = Al([Ke("formdown-ui")], jl);
function Ml(e, t) {
	if (Array.isArray(t)) {
		let n = Array.isArray(e) ? e.map(String) : e == null ? [] : [String(e)];
		return n.length === t.length && n.every((e, n) => e === t[n]);
	}
	return e == null ? t === "" || t === !1 : typeof t == "boolean" ? fc(e) === t : String(e) === t;
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/decorate.js
function Nl(e, t, n, r) {
	var i = arguments.length, a = i < 3 ? t : r === null ? r = Object.getOwnPropertyDescriptor(t, n) : r, o;
	if (typeof Reflect == "object" && typeof Reflect.decorate == "function") a = Reflect.decorate(e, t, n, r);
	else for (var s = e.length - 1; s >= 0; s--) (o = e[s]) && (a = (i < 3 ? o(a) : i > 3 ? o(t, n, a) : o(t, n)) || a);
	return i > 3 && a && Object.defineProperty(t, n, a), a;
}
// src/lowline-form.ts
var Pl = 300, $ = class extends We {
	constructor(...e) {
		super(...e), this.src = "/lowline", this.form = "", this.record = "", this.content = "", this.data = {}, this.rate = .05, this.strings = i, this.client = new s(this.src), this.fieldStates = {}, this.changed = () => {
			clearTimeout(this.asking), this.asking = setTimeout(() => void this.ask(), Pl);
		}, this.picked = (e) => {
			let { field: t, value: n } = e.detail, r = this.formdown;
			r && r.updateData({
				...r.data,
				[t]: n
			});
		}, this.declined = (e) => {
			let { field: t } = e.detail, n = this.formdown;
			this.session?.decline(t, this.values()) && n && n.updateData({
				...n.data,
				[t]: ""
			});
			let { [t]: r, ...i } = this.fieldStates;
			this.fieldStates = i, n && (n.fieldStates = i);
		};
	}
	createRenderRoot() {
		return this;
	}
	willUpdate(e) {
		e.has("src") && (this.client = new s(this.src)), (e.has("record") || e.has("form") || e.has("data") || e.has("content")) && (this.session = new a(this.record, r(this.data), this.rate, Math.random, this.strings), this.fieldStates = {});
	}
	updated(e) {
		(e.has("record") || e.has("form") || e.has("content")) && this.ask();
	}
	render() {
		return Ee`<formdown-ui
      .content=${this.content}
      .data=${this.data}
      .fieldStates=${this.fieldStates}
      @formdown-change=${this.changed}
      @formdown-suggestion-pick=${this.picked}
      @formdown-suggestion-decline=${this.declined}
    ></formdown-ui>`;
	}
	values() {
		return r(this.formdown?.data ?? this.data);
	}
	async save() {
		if (!this.session || !this.form || !this.record) throw Error("lowline-form needs a form and a record to save");
		let e = this.values(), t = await this.client.settle(this.form, this.record, e, this.session.draft);
		return this.session.saved(e), this.dispatchEvent(new CustomEvent("lowline-saved", {
			detail: {
				...t,
				values: e
			},
			bubbles: !0,
			composed: !0
		})), t;
	}
	async ask() {
		let e = this.session;
		if (!e || !this.form || !this.record) return;
		let t = this.values(), n;
		try {
			n = await this.client.propose(this.form, this.record, t);
		} catch (e) {
			this.dispatchEvent(new CustomEvent("lowline-unavailable", {
				detail: { error: e },
				bubbles: !0,
				composed: !0
			}));
			return;
		}
		if (e !== this.session) return;
		let r = e.apply(n, t);
		this.fieldStates = r.fieldStates;
		let i = this.formdown;
		i && (Object.keys(r.prefill).length > 0 && i.updateData({
			...i.data,
			...r.prefill
		}), i.fieldStates = this.fieldStates);
	}
	disconnectedCallback() {
		super.disconnectedCallback(), clearTimeout(this.asking);
	}
};
Nl([O()], $.prototype, "src", void 0), Nl([O()], $.prototype, "form", void 0), Nl([O()], $.prototype, "record", void 0), Nl([O()], $.prototype, "content", void 0), Nl([O({ attribute: !1 })], $.prototype, "data", void 0), Nl([O({ type: Number })], $.prototype, "rate", void 0), Nl([O({ attribute: !1 })], $.prototype, "strings", void 0), Nl([Xe("formdown-ui")], $.prototype, "formdown", void 0), $ = Nl([Ke("lowline-form")], $);
export { e as Draft, s as LowlineClient, o as LowlineError, $ as LowlineForm, a as Session, i as englishStrings, r as valuesOf };
