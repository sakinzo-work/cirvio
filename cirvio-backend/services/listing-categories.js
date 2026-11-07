const schoolClasses = ['Nursery', 'LKG', 'UKG', ...Array.from({ length: 10 }, (_, i) => `Class ${i + 1}`)];
const courses = (names, years) => names.map(name => ({ name, years }));
const taxonomy = {
    categories: [
        { name: 'School Books', group: 'Education', mode: 'school' },
        { name: 'College Books', group: 'Education', mode: 'college' },
        ...['Competitive Exams', 'Notes', 'Study Material', 'Guides & Reference', 'Question Banks', 'Practical Files'].map(name => ({ name, group: 'Study resources', mode: 'resource' })),
        ...['Novels', 'Calculators', 'Stationery Bundles', 'Drawing & Art Supplies', 'Lab & Engineering Tools', 'Bags & Accessories', 'Electronics & Accessories', 'Other Study Items'].map(name => ({ name, group: 'Other items', mode: 'general' }))
    ],
    levels: {
        school: { label: 'School · Nursery to Class 10', classes: schoolClasses },
        'higher-secondary': { label: 'Class 11 / Class 12', classes: ['Class 11', 'Class 12'] },
        undergraduate: { label: 'Undergraduate degree', courses: [...courses(['B.A.', 'B.Com.', 'B.Sc.', 'BBA', 'BCA', 'B.Ed.', 'B.S.W.'], 4), ...courses(['B.Tech.', 'B.E.', 'B.Pharm.', 'B.Des.'], 4), ...courses(['MBBS', 'BDS', 'B.Arch.', 'Integrated degree'], 6), { name: 'Other degree', years: 6 }] },
        masters: { label: "Master's degree / Postgraduate", courses: [...courses(['M.A.', 'M.Com.', 'M.Sc.', 'MBA', 'MCA', 'M.Tech.', 'M.E.', 'M.Pharm.', 'M.Ed.', 'M.S.W.', 'LL.M.'], 2), { name: 'Other postgraduate course', years: 4 }] },
        diploma: { label: 'Diploma / Polytechnic', courses: [...courses(['Engineering diploma', 'Pharmacy diploma', 'Education diploma', 'Design diploma'], 3), { name: 'Other diploma', years: 4 }] },
        doctorate: { label: 'Doctorate / Research', courses: [...courses(['Ph.D.', 'M.Phil.'], 6), { name: 'Other research programme', years: 6 }] },
        professional: { label: 'Professional / Certificate course', courses: [...courses(['CA', 'CS', 'CMA', 'Law', 'Certificate course'], 6), { name: 'Other professional course', years: 6 }] }
    },
    streams: ['Science (PCM)', 'Science (PCB)', 'Science (PCMB)', 'Commerce', 'Arts / Humanities', 'Vocational', 'Other'],
    boards: ['CBSE / NCERT', 'ICSE / ISC', 'State Board', 'IB', 'Cambridge', 'NIOS', 'Other'],
    itemTypes: {
        Calculators: ['Basic calculator', 'Scientific calculator', 'Financial calculator', 'Graphing calculator', 'Other'],
        'Stationery Bundles': ['Notebooks', 'Pens & pencils', 'Geometry set', 'Mixed stationery', 'Other'],
        'Drawing & Art Supplies': ['Drawing instruments', 'Art materials', 'Drawing sheets & books', 'Other'],
        'Lab & Engineering Tools': ['Lab equipment', 'Engineering instruments', 'Project components', 'Other'],
        'Bags & Accessories': ['School bag', 'College bag', 'Book covers & organisers', 'Other'],
        'Electronics & Accessories': ['Computer accessories', 'Study lamp', 'Headphones', 'Other'],
        'Other Study Items': ['Other']
    }
};

function normalizeClassification(category, input = {}) {
    const definition = taxonomy.categories.find(item => item.name === category);
    if (!definition) throw new Error('Please choose a valid category');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Please complete the category details');
    const result = {};
    const take = key => {
        const value = String(input[key] || '').trim();
        if (value.length > 100) throw new Error('Category details must be 100 characters or fewer');
        return value;
    };
    let level = take('level');
    if (definition.mode === 'school') level = ['Class 11', 'Class 12'].includes(take('className')) ? 'higher-secondary' : 'school';
    if (definition.mode === 'general') level = '';
    if (definition.mode === 'college' && (!taxonomy.levels[level]?.courses)) throw new Error('Choose a degree, diploma or postgraduate level');
    if (level) {
        const stage = taxonomy.levels[level];
        if (!stage) throw new Error('Choose a valid education level');
        result.level = level;
        if (stage.classes) {
            result.className = take('className');
            if (!stage.classes.includes(result.className)) throw new Error('Choose the class for this listing');
            const board = take('board');
            if (board && !taxonomy.boards.includes(board)) throw new Error('Choose a valid board');
            if (board) result.board = board;
            if (level === 'higher-secondary') {
                result.stream = take('stream');
                if (!taxonomy.streams.includes(result.stream)) throw new Error('Choose the Class 11 / 12 stream');
                if (result.stream === 'Other') {
                    result.streamOther = take('streamOther');
                    if (!result.streamOther) throw new Error('Enter the stream name');
                }
            }
        } else {
            result.course = take('course');
            const course = stage.courses.find(item => item.name === result.course);
            if (!course) throw new Error('Choose a course');
            result.year = take('year');
            if (!/^[1-6]$/.test(result.year) || Number(result.year) > course.years) throw new Error('Choose a valid study year');
            if (result.course.startsWith('Other')) {
                result.courseOther = take('courseOther');
                if (!result.courseOther) throw new Error('Enter the course name');
            }
        }
        if (take('subject')) result.subject = take('subject');
    } else if (definition.mode === 'school') throw new Error('Choose the class for this listing');
    const types = taxonomy.itemTypes[category];
    if (types) {
        result.itemType = take('itemType');
        if (!types.includes(result.itemType)) throw new Error('Choose the item type');
        if (result.itemType === 'Other') {
            result.itemOther = take('itemOther');
            if (!result.itemOther) throw new Error('Describe the item type');
        }
    }
    return result;
}

function describeClassification(data = {}) {
    if (!data || typeof data !== 'object') return '';
    const parts = [data.className || taxonomy.levels[data.level]?.label, data.streamOther || data.stream, data.courseOther || data.course, data.year ? `Year ${data.year}` : '', data.board, data.subject, data.itemOther || data.itemType];
    return parts.filter(Boolean).join(' · ');
}

module.exports = { taxonomy, normalizeClassification, describeClassification };
