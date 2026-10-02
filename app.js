'use strict';

// GitHub Pages is a static host. No service credentials or cloud API calls belong here.
(() => {
    const STORAGE_KEY = 'course-schedule.local.v1';
    const MAX_COURSES = 1000;
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const MAX_XML_BYTES = 2 * 1024 * 1024;
    const MAX_TEXT_LENGTH = 100000;
    const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const $ = id => document.getElementById(id);
    let courses = [];
    let processing = false;

    function element(tag, className = '', text) {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    function notify(message) {
        $('appMessage').textContent = message;
        $('appMessage').classList.remove('hidden');
    }

    function normalizeCourse(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('课程格式无效');
        }
        const student = value.student_name;
        const day = value.day;
        const start = value.start_time;
        const end = value.end_time;
        const validTime = time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
        if (typeof student !== 'string' || !student.trim() || student.trim().length > 120 ||
            !((typeof day === 'string' && /^[0-6]$/.test(day)) ||
              (Number.isInteger(day) && day >= 0 && day <= 6)) ||
            !validTime(start) || !validTime(end) || start >= end) {
            throw new Error('请检查姓名（1–120字）、星期和时间；结束时间须晚于开始时间');
        }
        // Select only supported fields; never merge objects or interpret markup from imported data.
        return { student_name: student.trim(), day: String(day), start_time: start, end_time: end };
    }

    function normalizeCourses(value) {
        if (!Array.isArray(value) || value.length > MAX_COURSES) {
            throw new Error(`课程数据必须为数组，最多${MAX_COURSES}条`);
        }
        return value.map(normalizeCourse);
    }

    function decodeBackup(text) {
        if (text.length > MAX_XML_BYTES) throw new Error('JSON内容过大');
        const parsed = JSON.parse(text);
        // Also accept a plain array using the original course field names for owner-managed migration.
        if (Array.isArray(parsed)) return normalizeCourses(parsed);
        if (!parsed || parsed.schemaVersion !== 1) throw new Error('不支持的备份版本');
        return normalizeCourses(parsed.courses);
    }

    function readStoredCourses() {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw === null ? [] : decodeBackup(raw);
    }

    function refreshFromStorage() {
        try {
            courses = readStoredCourses();
            $('connectionStatus').textContent = '本地模式 · 无云端同步';
            renderAll();
        } catch {
            $('connectionStatus').textContent = '本地存储不可用';
            notify('无法读取本地课程，可能是存储被禁用或数据损坏。原数据未被覆盖，请先备份并检查浏览器设置。');
        }
    }

    function saveCourses(additions) {
        const validated = normalizeCourses(additions);
        if (!validated.length) throw new Error('没有可保存的课程');
        // Re-read before writing to reduce stale-tab overwrites (simultaneous writes may still race).
        const next = normalizeCourses([...readStoredCourses(), ...validated]);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, courses: next }));
        courses = next;
        renderAll();
        notify(`已在当前浏览器保存${validated.length}条课程。请导出JSON备份，避免清理网站数据后丢失。`);
    }

    function trySave(additions) {
        try {
            saveCourses(additions);
            return true;
        } catch (error) {
            const message = error.name === 'QuotaExceededError' || error.name === 'SecurityError'
                ? '浏览器存储不可用或已满；课程未保存，输入内容已保留。请检查设置或可用空间。'
                : `未保存任何课程：${error.message}`;
            notify(message);
            return false;
        }
    }

    function selectedLocalDate() {
        // A date input is a local calendar date, not a UTC timestamp.
        const [year, month, day] = $('selectedDate').value.split('-').map(Number);
        if (!year || !month || !day) return null;
        return new Date(year, month - 1, day);
    }

    function courseCard(course) {
        const card = element('div', 'p-3 bg-gray-50 rounded-md border border-gray-100');
        card.append(element('div', 'font-medium course-name', course.student_name));
        card.append(element('div', 'text-sm text-gray-600', `${DAY_NAMES[Number(course.day)]} ${course.start_time} - ${course.end_time}`));
        return card;
    }

    function renderAll() {
        const sorted = [...courses].sort((a, b) => Number(a.day) - Number(b.day) || a.start_time.localeCompare(b.start_time));
        $('classList').replaceChildren(...sorted.map(courseCard));
        if (!sorted.length) $('classList').append(element('p', 'text-gray-500', '暂无本地课程数据'));
        const date = selectedLocalDate();
        const time = $('selectedTime').value;
        const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
        $('currentClassContainer').replaceChildren();
        $('todayOverview').replaceChildren();
        if (!date || !validTime) {
            $('currentViewTitle').textContent = '请选择日期和时间';
            $('currentClassContainer').append(element('p', 'text-gray-500', '请选择有效的日期和时间'));
            return;
        }
        $('currentViewTitle').textContent = `${date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })} ${time} 上课情况`;
        const today = sorted.filter(course => Number(course.day) === date.getDay());
        const current = today.filter(course => time >= course.start_time && time < course.end_time);
        $('currentClassContainer').append(...current.map(courseCard));
        if (!current.length) $('currentClassContainer').append(element('p', 'text-gray-500', '该时间没有人上课'));
        $('todayOverview').append(...today.map(courseCard));
        if (!today.length) $('todayOverview').append(element('p', 'text-gray-500', '当天没有课程安排'));
    }

    function useCurrentDateTime() {
        const now = new Date();
        const pad = number => String(number).padStart(2, '0');
        $('selectedDate').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        $('selectedTime').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        renderAll();
    }

    function addField(row, labelText, className, value, type = 'text') {
        const label = element('label', 'field', labelText);
        const input = element(type === 'select' ? 'select' : 'input', className);
        if (type === 'select') {
            DAY_NAMES.forEach((name, day) => {
                const option = element('option', '', name);
                option.value = String(day);
                input.append(option);
            });
        } else {
            input.type = type;
            if (type === 'text') input.maxLength = 120;
        }
        input.value = value;
        label.append(input);
        row.append(label);
    }

    function displayParsedCourses(results) {
        $('parsedCourses').replaceChildren();
        results.forEach(course => {
            const wrapper = element('div', 'course-item p-3 border border-gray-200 rounded-md');
            const row = element('div', 'flex flex-col md:flex-row flex-wrap gap-4');
            addField(row, '学生姓名', 'student-name', course.student_name);
            addField(row, '星期', 'course-day', course.day, 'select');
            addField(row, '开始时间', 'course-start', course.start_time, 'time');
            addField(row, '结束时间', 'course-end', course.end_time, 'time');
            const remove = element('button', 'remove-course', '移除此条');
            remove.type = 'button';
            // Bind the actual node, not an index that changes after another row is removed.
            remove.addEventListener('click', () => wrapper.remove());
            row.append(remove);
            wrapper.append(row);
            $('parsedCourses').append(wrapper);
        });
        $('parsedCoursesContainer').classList.remove('hidden');
        $('saveParsedCourses').disabled = !results.length;
    }

    function parseCourseText(text) {
        if (text.length > MAX_TEXT_LENGTH) throw new Error('文本内容过长，请分批导入');
        const results = [];
        const days = '日一二三四五六';
        let skipped = 0;
        for (const line of text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
            const timeMatches = [...line.matchAll(/(?<![\d:])(\d{1,2}[:-]\d{2})\s*[-–—~～至到]\s*(\d{1,2}[:-]\d{2})(?![\d:])/g)];
            const dayMatches = [...line.matchAll(/(?:周|星期)([日天一二三四五六])/g)];
            if (timeMatches.length !== 1 || dayMatches.length !== 1) { skipped++; continue; }
            const match = timeMatches[0];
            const dayMatch = dayMatches[0];
            const normalizeTime = value => value.replace('-', ':').padStart(5, '0');
            const candidate = {
                student_name: line.replace(match[0], '').replace(dayMatch[0], '').trim(),
                day: String(days.indexOf(dayMatch[1] === '天' ? '日' : dayMatch[1])),
                start_time: normalizeTime(match[1]),
                end_time: normalizeTime(match[2])
            };
            try { results.push(normalizeCourse(candidate)); } catch { skipped++; }
            if (results.length > MAX_COURSES) throw new Error(`一次最多解析${MAX_COURSES}条课程`);
        }
        if (!results.length) throw new Error('没有找到有效课程。格式示例：张三 周一 09:00-10:30');
        return { results, skipped };
    }

    function readZipText(entry) {
        // Limit expanded XML, not just the compressed upload, to contain ZIP-bomb memory use.
        return new Promise((resolve, reject) => {
            let size = 0;
            let stopped = false;
            const chunks = [];
            const stream = entry.internalStream('uint8array');
            stream.on('data', chunk => {
                if (stopped) return;
                size += chunk.length;
                if (size > MAX_XML_BYTES) {
                    stopped = true;
                    stream.pause();
                    reject(new Error('DOCX正文过大，请分拆文档'));
                    return;
                }
                chunks.push(chunk);
            }).on('error', () => {
                if (!stopped) reject(new Error('DOCX正文解压失败'));
            }).on('end', () => {
                if (stopped) return;
                try {
                    const bytes = new Uint8Array(size);
                    let offset = 0;
                    chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
                    resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
                } catch {
                    reject(new Error('DOCX正文不是有效的UTF-8文本'));
                }
            }).resume();
        });
    }

    async function readDocx(file) {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const entry = zip.file('word/document.xml');
        if (!entry) throw new Error('不是有效的DOCX文档');
        const xml = await readZipText(entry);
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持包含外部实体的文档');
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('DOCX正文格式无效');
        const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        // Preserve table rows as course lines instead of separating each cell into a line.
        const textOf = node => {
            if (node.namespaceURI === ns) {
                if (node.localName === 't') return node.textContent;
                if (node.localName === 'br' || node.localName === 'cr') return '\n';
                if (node.localName === 'tab') return ' ';
            }
            return Array.from(node.children || [], textOf).join('');
        };
        const insideRow = node => {
            for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                if (parent.namespaceURI === ns && parent.localName === 'tr') return true;
            }
            return false;
        };
        const lines = [];
        for (const node of doc.getElementsByTagNameNS(ns, '*')) {
            if (node.localName === 'tr') {
                lines.push(Array.from(node.getElementsByTagNameNS(ns, 'tc'), textOf).join(' '));
            } else if (node.localName === 'p' && !insideRow(node)) {
                lines.push(textOf(node));
            }
        }
        return lines.join('\n');
    }

    async function processFile() {
        if (processing) return;
        const file = $('fileUpload').files[0];
        if (!file) return;
        processing = true;
        $('fileUpload').disabled = true;
        $('startRecognition').disabled = true;
        $('parseText').disabled = true;
        $('recognitionProgress').classList.remove('hidden', 'progress-done');
        $('recognitionProgress').classList.add('progress-active');
        $('progressPercent').textContent = '50%';
        $('progressText').textContent = '正在本地读取文件...';
        try {
            if (file.size > MAX_FILE_BYTES) throw new Error('文件过大，上限为10MB');
            const extension = file.name.split('.').pop().toLowerCase();
            if (extension === 'json') {
                const imported = decodeBackup(await file.text());
                displayParsedCourses(imported);
                notify(`已读取${imported.length}条课程，请检查后保存。保存将追加至当前浏览器，不会覆盖旧课程。`);
            } else {
                let text;
                if (extension === 'txt') text = await file.text();
                else if (extension === 'docx') text = await readDocx(file);
                else throw new Error('仅支持DOCX、TXT和JSON。PDF/图片识别需安全后端，当前已停用');
                if (text.length > MAX_TEXT_LENGTH) throw new Error('文本内容过长，请分批导入');
                if (!text.trim()) throw new Error('文件中没有可读取的文本');
                $('recognizedText').value = text;
                $('parsedCoursesContainer').classList.add('hidden');
                notify('文件已在本地读取，请检查文本并解析课程信息');
            }
            $('recognitionProgress').classList.replace('progress-active', 'progress-done');
            $('progressPercent').textContent = '100%';
            $('progressText').textContent = '本地读取完成';
        } catch (error) {
            $('recognitionProgress').classList.add('hidden');
            notify(`读取失败：${error.message}`);
        } finally {
            processing = false;
            $('fileUpload').disabled = false;
            $('startRecognition').disabled = !$('fileUpload').files.length;
            $('parseText').disabled = false;
        }
    }

    $('fileUpload').addEventListener('change', () => {
        const file = $('fileUpload').files[0];
        $('startRecognition').disabled = !file;
        $('fileInfo').classList.toggle('hidden', !file);
        $('fileName').textContent = file ? file.name : '未选择文件';
        $('fileSize').textContent = file ? `(${(file.size / 1024).toFixed(1)}KB)` : '';
        $('recognitionProgress').classList.add('hidden');
        $('parsedCoursesContainer').classList.add('hidden');
    });
    $('startRecognition').addEventListener('click', processFile);
    $('parseText').addEventListener('click', () => {
        try {
            const { results, skipped } = parseCourseText($('recognizedText').value);
            displayParsedCourses(results);
            notify(`已解析${results.length}条课程${skipped ? `，${skipped}行无效或未识别` : ''}。请检查并编辑后保存。`);
        } catch (error) {
            $('parsedCoursesContainer').classList.add('hidden');
            notify(error.message);
        }
    });
    $('saveParsedCourses').addEventListener('click', () => {
        const additions = Array.from($('parsedCourses').children, row => ({
            student_name: row.querySelector('.student-name').value,
            day: row.querySelector('.course-day').value,
            start_time: row.querySelector('.course-start').value,
            end_time: row.querySelector('.course-end').value
        }));
        if (trySave(additions)) {
            $('parsedCourses').replaceChildren();
            $('parsedCoursesContainer').classList.add('hidden');
            $('saveParsedCourses').disabled = true;
            $('fileUpload').value = '';
            $('fileInfo').classList.add('hidden');
            $('startRecognition').disabled = true;
        }
    });
    $('addClass').addEventListener('click', () => {
        if (trySave([{
            student_name: $('studentName').value,
            day: $('classDay').value,
            start_time: $('classStartTime').value,
            end_time: $('classEndTime').value
        }])) {
            $('studentName').value = '';
            $('classStartTime').value = '';
            $('classEndTime').value = '';
        }
    });
    $('exportCourses').addEventListener('click', () => {
        try {
            const latest = readStoredCourses();
            const blob = new Blob([JSON.stringify({ schemaVersion: 1, courses: latest }, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = element('a');
            link.href = url;
            link.download = 'course-schedule-backup.json';
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            notify('已生成JSON备份；文件含课程与姓名，请妥善保管');
        } catch {
            notify('无法读取本地存储，未生成备份。原数据未被修改。');
        }
    });
    $('useCurrentTime').addEventListener('click', useCurrentDateTime);
    $('selectedDate').addEventListener('change', renderAll);
    $('selectedTime').addEventListener('change', renderAll);
    window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY || event.key === null) refreshFromStorage();
    });
    useCurrentDateTime();
    refreshFromStorage();
})();
