/* Category options and validation come from the same taxonomy used by the API. */
(() => {
    const category = document.getElementById('itemCategory');
    const fields = document.getElementById('classificationFields');
    const status = document.getElementById('categoryLoadStatus');
    const retry = document.getElementById('retryCategories');
    let taxonomy = null;
    const definitions = [
        ['level', 'Education level', 'select'], ['className', 'Class', 'select'],
        ['stream', 'Stream', 'select'], ['streamOther', 'Stream name', 'input'],
        ['course', 'Course / Degree', 'select'], ['courseOther', 'Course name', 'input'],
        ['year', 'Study year', 'select'], ['board', 'Board (optional)', 'select'],
        ['subject', 'Subject / Specialisation (optional)', 'input'],
        ['itemType', 'Item type', 'select'], ['itemOther', 'Describe the item type', 'input']
    ];
    fields.innerHTML = definitions.map(([key, label, tag]) => `<div class="field-group" hidden><label for="classification-${key}">${label}</label><${tag} id="classification-${key}" data-classification="${key}" ${tag === 'input' ? 'type="text" maxlength="100"' : ''} disabled></${tag}><div class="field-error">Please complete this field.</div></div>`).join('');
    const control = key => document.getElementById('classification-' + key);
    const value = () => Object.fromEntries([...fields.querySelectorAll('[data-classification]:not(:disabled)')].map(input => [input.dataset.classification, input.value.trim()]));
    function options(key, items, placeholder) {
        const input = control(key);
        const previous = input.value;
        input.replaceChildren(new Option(placeholder || 'Select an option', ''), ...items.map(item => new Option(item.label || item.name || item, item.value || item.name || item)));
        if ([...input.options].some(option => option.value === previous)) input.value = previous;
    }
    function show(key, visible, required = true) {
        const input = control(key);
        input.closest('.field-group').hidden = !visible;
        input.disabled = !visible;
        input.required = visible && required;
        if (!visible) { input.value = ''; input.closest('.field-group').classList.remove('invalid'); }
    }
    function summary() {
        const data = value();
        return [data.className || taxonomy?.levels[data.level]?.label, data.streamOther || data.stream, data.courseOther || data.course, data.year ? `Year ${data.year}` : '', data.board, data.subject, data.itemOther || data.itemType].filter(Boolean).join(' · ');
    }
    function update() {
        if (!taxonomy) return;
        const mode = taxonomy.categories.find(item => item.name === category.value)?.mode;
        const levelChoices = Object.entries(taxonomy.levels).filter(([, stage]) => mode !== 'college' || stage.courses).map(([key, stage]) => ({ value: key, label: stage.label }));
        options('level', levelChoices, mode === 'college' ? 'Choose education level' : 'General / Not class-specific');
        show('level', mode === 'college' || mode === 'resource', mode === 'college');
        const level = mode === 'school' ? 'school' : control('level').value;
        const stage = taxonomy.levels[level];
        const classes = mode === 'school' ? [...taxonomy.levels.school.classes, ...taxonomy.levels['higher-secondary'].classes] : (stage?.classes || []);
        options('className', classes, 'Choose class');
        show('className', classes.length > 0);
        const senior = ['Class 11', 'Class 12'].includes(control('className').value);
        options('stream', taxonomy.streams, 'Choose stream');
        show('stream', senior);
        show('streamOther', senior && control('stream').value === 'Other');
        options('board', taxonomy.boards, 'Not specified');
        show('board', classes.length > 0, false);
        options('course', stage?.courses || [], 'Choose course');
        show('course', !!stage?.courses);
        const course = stage?.courses?.find(item => item.name === control('course').value);
        show('courseOther', !!course?.name.startsWith('Other'));
        const yearNames = ['First year', 'Second year', 'Third year', 'Fourth year', 'Fifth year', 'Sixth year'];
        options('year', Array.from({ length: course?.years || 0 }, (_, index) => ({ value: String(index + 1), label: yearNames[index] })), 'Choose year');
        show('year', !!course);
        show('subject', !!stage || mode === 'school', false);
        const types = taxonomy.itemTypes[category.value] || [];
        options('itemType', types, 'Choose item type');
        show('itemType', types.length > 0);
        if (types.length === 1) control('itemType').value = types[0];
        show('itemOther', control('itemType').value === 'Other');
        status.textContent = !mode ? 'Choose a category to see the relevant options.' : (mode === 'general' ? 'Choose the item type when available.' : 'Add the class or course so buyers can find the right material.');
        document.getElementById('classificationSummary').textContent = summary();
        if (typeof updatePreview === 'function') updatePreview();
    }
    fields.addEventListener('change', update);
    fields.addEventListener('input', () => {
        document.getElementById('classificationSummary').textContent = summary();
        if (typeof updatePreview === 'function') updatePreview();
    });
    category.addEventListener('change', () => {
        fields.querySelectorAll('select, input').forEach(input => { input.value = ''; input.closest('.field-group').classList.remove('invalid'); });
        update();
    });
    async function load() {
        category.disabled = true;
        status.textContent = 'Loading category options...';
        retry.hidden = true;
        try {
            taxonomy = await CirvioAPI.request('/api/products/categories');
            if (!Array.isArray(taxonomy.categories) || !taxonomy.levels) throw new Error('Category options are unavailable. Please retry.');
            const selected = category.value;
            category.replaceChildren(new Option('Select category', ''));
            for (const group of [...new Set(taxonomy.categories.map(item => item.group))]) {
                const optionGroup = document.createElement('optgroup'); optionGroup.label = group;
                taxonomy.categories.filter(item => item.group === group).forEach(item => optionGroup.append(new Option(item.name, item.name)));
                category.append(optionGroup);
            }
            category.value = selected;
            category.disabled = false;
            update();
        } catch (error) {
            taxonomy = null;
            status.textContent = error.message;
            retry.hidden = false;
        }
    }
    retry.addEventListener('click', load);
    window.SellCategories = {
        value() {
            const data = value();
            if (category.value === 'School Books') data.level = ['Class 11', 'Class 12'].includes(data.className) ? 'higher-secondary' : 'school';
            return data;
        }, summary,
        validate() {
            if (!taxonomy) { status.textContent = 'Reload category options before publishing.'; retry.hidden = false; return false; }
            let valid = true;
            fields.querySelectorAll('input:not(:disabled), select:not(:disabled)').forEach(input => {
                const ok = !input.required || !!input.value.trim();
                input.closest('.field-group').classList.toggle('invalid', !ok);
                if (!ok) valid = false;
            });
            return valid;
        }
    };
    load();
})();
