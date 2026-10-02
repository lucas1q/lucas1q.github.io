'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const JSZip = require('../vendor/jszip-3.10.2.min.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Deliberately small DOM test double: any HTML parsing sink throws.
// This verifies application logic and safe DOM construction, not browser layout/CSP enforcement.
class Node {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.className = ''; this.value = ''; this.textContent = ''; this.listeners = {}; this.disabled = false; this.files = []; }
    set innerHTML(_) { throw new Error('Unsafe HTML sink'); }
    append(...nodes) { nodes.forEach(node => { this.children.push(node); node.parentElement = this; }); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    get classList() {
        const node = this;
        return { add(...values) {node.className += ' ' + values.join(' ');}, remove(...values) {node.className = node.className.split(' ').filter(x => !values.includes(x)).join(' ');}, toggle(value, hide) {hide ? this.add(value) : this.remove(value);}, replace(a,b) {this.remove(a);this.add(b);} };
    }
    querySelectorAll(selector) { return this.children.flatMap(node => [(node.className.split(' ').includes(selector.slice(1)) ? node : null), ...node.querySelectorAll(selector)]).filter(Boolean); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Node()]));
const get = id => nodes.get(id);
const data = new Map();
let blocked = false;
const localStorage = {
    getItem(key) {return data.get(key) ?? null;},
    setItem(key, value) {if(blocked) {const error = new Error('full');error.name='QuotaExceededError';throw error;} data.set(key,value);}
};
const exportsList = ['normalizeCourse','normalizeCourses','decodeBackup','saveCourses','trySave','renderAll','displayParsedCourses','parseCourseText','readZipText','readDocx','processFile'];
const testSource = source.replace('    useCurrentDateTime();\n    refreshFromStorage();', `    globalThis.testApp = { ${exportsList.join(',')} };`);
const context = vm.createContext({document:{getElementById:get,createElement:tag=>new Node(tag)},localStorage,window:{addEventListener(){}},JSZip,TextDecoder,Uint8Array,Date,Blob,URL,setTimeout,console});
vm.runInContext(testSource,context);
const app = context.testApp;
const plain = value => JSON.parse(JSON.stringify(value));
const course = {student_name:'张三',day:'1',start_time:'09:00',end_time:'10:00'};
const KEY = 'course-schedule.local.v1';
let total=0;
function test(name, fn) { fn();total++;console.log(`PASS ${name}`); }
async function asyncTest(name, fn) { await fn();total++;console.log(`PASS ${name}`); }
(async()=>{
    test('static security boundary',()=>{
        assert.doesNotMatch(source,/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
        assert.doesNotMatch(html,/https?:\/\/|\son\w+\s*=/);
        assert.match(html,/connect-src 'none'/);assert.match(html,/script-src 'self'/);
        assert.doesNotMatch(html+source,/ROBOFLOW_API_KEY|SHEETDB_API_URL|infer\.roboflow\.com|sheetdb\.io/);
    });
    test('strict field types, ranges and time validation',()=>{
        assert.deepEqual(plain(app.normalizeCourse(course)),course);
        for(const mutation of [{day:'1x'},{day:7},{day:false},{start_time:'9:00'},{start_time:'24:00'},{end_time:'08:00'},{student_name:''},{student_name:'x'.repeat(121)},{student_name:{}}]) assert.throws(()=>app.normalizeCourse({...course,...mutation}));
        assert.throws(()=>app.normalizeCourses(Array(1001).fill(course)));
        assert.throws(()=>app.normalizeCourses({courses:[]}));
    });
    test('JSON schema and unknown keys are handled without object merging',()=>{
        const poison=JSON.parse(JSON.stringify(course).replace('"day":"1"','"day":"1","__proto__":{"polluted":true}'));
        assert.deepEqual(plain(app.decodeBackup(JSON.stringify([poison]))),[course]);
        assert.deepEqual(plain(app.decodeBackup(JSON.stringify({schemaVersion:1,courses:[course]}))),[course]);
        assert.throws(()=>app.decodeBackup('{broken'));
        assert.throws(()=>app.decodeBackup(JSON.stringify({schemaVersion:2,courses:[]})));
        assert.equal({}.polluted,undefined);
    });
    test('parser validates Sunday, invalid times and ambiguous lines',()=>{
        assert.equal(app.parseCourseText('张三 周天 9:00-10:00').results[0].day,'0');
        for(const line of ['张三 周一 109:00-10:00','张三 周一 29:00-30:00','张三 周一 09:00-10:00 李四 周二 11:00-12:00','张三 周一 09:00-10:00 11:00-12:00']) assert.throws(()=>app.parseCourseText(line));
        assert.equal(app.parseCourseText('坏数据\n张三 周一 09:00-10:00').skipped,1);
        assert.throws(()=>app.parseCourseText('x'.repeat(100001)));
    });
    const payload='\"><img src=x onerror="window.xss=1"><svg onload="window.xss=2">';
    get('selectedDate').value='2026-10-05';get('selectedTime').value='09:30';
    test('malicious text saved and displayed through safe DOM APIs',()=>{
        app.saveCourses([{...course,student_name:payload}]);
        for(const id of ['classList','todayOverview','currentClassContainer']) assert.equal(get(id).querySelector('.course-name').textContent,payload);
        assert.equal(JSON.parse(data.get(KEY)).courses[0].student_name,payload);
    });
    test('end time boundary excludes completed course',()=>{
        get('selectedTime').value='10:00';app.renderAll();assert.equal(get('currentClassContainer').querySelector('.course-name'),null);get('selectedTime').value='09:30';
    });
    test('invalid batch and failed persistence preserve previous data and visible state',()=>{
        const before=data.get(KEY);assert.equal(app.trySave([course,{...course,day:'bad'}]),false);assert.equal(data.get(KEY),before);
        blocked=true;assert.equal(app.trySave([course]),false);blocked=false;assert.equal(data.get(KEY),before);assert.match(get('appMessage').textContent,/课程未保存/);
    });
    test('preview uses value assignment and removal remains correct after earlier removal',()=>{
        app.displayParsedCourses([{...course,student_name:payload},course,course]);
        assert.equal(get('parsedCourses').querySelector('.student-name').value,payload);
        const buttons=get('parsedCourses').querySelectorAll('.remove-course');buttons[0].listeners.click();buttons[2].listeners.click();
        assert.equal(get('parsedCourses').children.length,1);
    });
    test('batch editor validates all rows and prevents a duplicate second save',()=>{
        app.displayParsedCourses([course,course]);
        get('parsedCourses').querySelectorAll('.student-name')[1].value='';const before=data.get(KEY);
        get('saveParsedCourses').listeners.click();assert.equal(data.get(KEY),before);
        get('parsedCourses').querySelectorAll('.student-name')[1].value='李四';get('saveParsedCourses').listeners.click();
        const saved=data.get(KEY);get('saveParsedCourses').listeners.click();assert.equal(data.get(KEY),saved);assert.equal(get('parsedCourses').children.length,0);
    });
    test('corrupt stored data is never silently overwritten',()=>{
        const before=data.get(KEY);data.set(KEY,'broken');assert.equal(app.trySave([course]),false);assert.equal(data.get(KEY),'broken');data.set(KEY,before);
    });
    await asyncTest('vendored ZIP decoding bounds expanded XML and rejects invalid UTF-8',async()=>{
        for(const [contents,valid] of [[Buffer.from('<document/>'),true],[Buffer.from([0xff]),false],[Buffer.alloc(2*1024*1024+1,120),false]]){
            const zip=new JSZip();zip.file('word/document.xml',contents);const loaded=await JSZip.loadAsync(await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
            const result=app.readZipText(loaded.file('word/document.xml'));
            if(valid) assert.equal(await result,'<document/>');else await assert.rejects(result);
        }
    });
    await asyncTest('TXT and JSON imports require review and unsupported OCR fails closed',async()=>{
        const before=data.get(KEY);
        get('fileUpload').files=[{name:'courses.txt',size:32,text:async()=> '张三 周一 09:00-10:00'}];await app.processFile();assert.equal(get('recognizedText').value,'张三 周一 09:00-10:00');
        get('fileUpload').files=[{name:'backup.json',size:80,text:async()=>JSON.stringify([course])}];await app.processFile();assert.equal(get('parsedCourses').children.length,1);assert.equal(data.get(KEY),before);
        get('fileUpload').files=[{name:'photo.png',size:20}];await app.processFile();assert.match(get('appMessage').textContent,/当前已停用/);assert.equal(get('fileUpload').disabled,false);
        get('fileUpload').files=[{name:'large.txt',size:10*1024*1024+1}];await app.processFile();assert.match(get('appMessage').textContent,/上限为10MB/);
    });
    await asyncTest('malformed DOCX restores controls after decoding error',async()=>{
        const zip=new JSZip();zip.file('word/document.xml',Buffer.from([0xff]));const bytes=await zip.generateAsync({type:'uint8array'});
        get('fileUpload').files=[{name:'bad.docx',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];await app.processFile();assert.match(get('appMessage').textContent,/UTF-8/);assert.equal(get('fileUpload').disabled,false);assert.equal(get('parseText').disabled,false);
    });
    await asyncTest('DOCX document order retains manual line breaks and table-cell boundaries',async()=>{
        const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        function xml(name,text='',children=[]){const n=new Node();n.localName=name;n.namespaceURI=ns;n.textContent=text;n.append(...children);n.getElementsByTagNameNS=(_,tag)=>n.children.flatMap(c=>[...(tag==='*'||c.localName===tag?[c]:[]),...c.getElementsByTagNameNS(ns,tag)]);return n;}
        const doc=xml('document','',[xml('body','',[xml('p','',[xml('r','',[xml('t','张三 周一 09:00-10:00'),xml('br'),xml('t','李四 周二 11:00-12:00')])]),xml('tbl','',[xml('tr','',[xml('tc','',[xml('p','',[xml('t','王五')])]),xml('tc','',[xml('p','',[xml('t','周三')])]),xml('tc','',[xml('p','',[xml('t','13:00-14:00')])])])])])]);
        doc.getElementsByTagName=()=>[];context.DOMParser=class {parseFromString(){return doc;}};
        const zip=new JSZip();zip.file('word/document.xml','<document/>');const bytes=await zip.generateAsync({type:'uint8array'});
        assert.equal(await app.readDocx({arrayBuffer:async()=>bytes.buffer}),'张三 周一 09:00-10:00\n李四 周二 11:00-12:00\n王五 周三 13:00-14:00');
    });
    console.log(`All ${total} Node security/logic checks passed. Browser behavior is covered separately by browser.cjs.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
