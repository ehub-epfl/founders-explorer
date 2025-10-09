// NOTE: Place programs_tree.json under client/public/ so it is served at /programs_tree.json
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MA_PROJECT_LEVELS,
    inferMinorSeasonLabel,
    inferSemesterFromLevel,
    shouldSkipMinorQuestion,
} from '../utils/levels';

function Questionnaire() {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(0);
    const [formData, setFormData] = useState({
        program: '',
        semester: '',
        major: '',
        minor: ''
    });
    const [programsTree, setProgramsTree] = useState(null);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        async function loadTree() {
            try {
                // programs_tree.json must be placed under client/public
                const res = await fetch('/programs_tree.json', { cache: 'no-store' });
                if (!res.ok) throw new Error(`Failed to fetch programs_tree.json: ${res.status}`);
                const ctype = res.headers.get('content-type') || '';
                if (!ctype.includes('application/json')) {
                    // Avoid parsing HTML error pages as JSON
                    const text = await res.text();
                    throw new Error(`Unexpected content-type: ${ctype}. Body starts with: ${text.slice(0, 60)}`);
                }
                const json = await res.json();
                setProgramsTree(json);
            } catch (e) {
                console.error(e);
                setLoadError(e.message || String(e));
            }
        }
        loadTree();
    }, []);

    // Submit handler
    const handleSubmit = (data = formData) => {
        const degree = (data.program || '').trim();
        const level = (data.semester || '').trim();
        const major = (data.major || '').trim();
        const minor = (data.minor || '').trim();
        const inferredSemester = inferSemesterFromLevel(level);

        const params = new URLSearchParams();
        if (degree) params.set('degree', degree);
        if (level) params.set('level', level);
        if (major) params.set('major', major);
        if (degree === 'MA' && minor) params.set('minor', minor);
        if (inferredSemester) params.set('semester', inferredSemester);

        const qs = params.toString();
        navigate(qs ? `/courses?${qs}` : '/courses');
    };

    // Compute options for the current step without using hooks later in the tree.
    const computeOptions = (stepIndex, data, tree) => {
        if (!tree) return [];
        const safeKeys = (obj) => obj ? Object.keys(obj) : [];
        const step = [
            {
                key: 'program',
                get: () => {
                    const base = safeKeys(tree);
                    if (base.length === 0) return [];
                    return [...base, 'Other'];
                }
            },
            {
                key: 'semester',
                get: () => {
                    const p = data.program;
                    if (!p || !tree || !tree[p]) return [];
                    if (p === 'PhD') return [];
                    const keys = Object.keys(tree[p] || {});
                    if (p === 'MA') {
                        const numeric = keys.filter(k => /^MA\d+$/i.test(k)).sort();
                        const result = numeric.slice();
                        for (const label of MA_PROJECT_LEVELS) {
                            if (!result.includes(label)) result.push(label);
                        }
                        return result.length ? [...result, 'Other'] : ['Other'];
                    }
                    if (p === 'BA') {
                        const semesters = keys.filter(k => /^BA\d+$/i.test(k));
                        return semesters.length ? [...semesters, 'Other'] : ['Other'];
                    }
                    return ['Other'];
                }
            },
            {
                key: 'major',
                get: () => {
                    const p = data.program;
                    if (!p) return [];
                    if (p === 'PhD') {
                        const list = Array.isArray(tree.PhD?.edoc) ? tree.PhD.edoc : [];
                        return list.length ? [...list, 'Other'] : ['Other'];
                    }
                    const sem = data.semester;
                    if (!sem || !tree[p]) return [];
                    const bucket = tree[p];
                    const list = Array.isArray(bucket?.[sem]) ? bucket[sem] : [];
                    return list.length ? [...list, 'Other'] : ['Other'];
                }
            },
            {
                key: 'minor',
                get: () => {
                    if (shouldSkipMinorQuestion(data.program, data.semester)) return [];
                    const sem = data.semester || '';
                    const autumn = Array.isArray(tree.MA?.['Minor Autumn Semester']) ? tree.MA['Minor Autumn Semester'] : [];
                    const spring = Array.isArray(tree.MA?.['Minor Spring Semester']) ? tree.MA['Minor Spring Semester'] : [];
                    const season = inferMinorSeasonLabel(data.program, sem);
                    let list = [];
                    if (season === 'Minor Autumn Semester') {
                        list = autumn;
                    } else if (season === 'Minor Spring Semester') {
                        list = spring;
                    } else {
                        const set = new Set([...autumn, ...spring]);
                        list = [...set];
                    }
                    return list.length ? [...list, 'Other'] : ['Other'];
                }
            }
        ][stepIndex];
        return step ? step.get() : [];
    };

    const allQuestions = [
        {
            key: 'program',
            question: 'Which program are you in?',
            getOptions: () => {
                const base = Object.keys(programsTree || {});
                if (base.length === 0) return [];
                return [...base, 'Other'];
            }
        },
        {
            key: 'semester',
            question: 'Which semester?',
            getOptions: (formData) => {
                const p = formData.program;
                if (!p || !programsTree || !programsTree[p]) return [];
                if (p === 'PhD') return [];
                const keys = Object.keys(programsTree[p] || {});
                if (p === 'MA') {
                    const numeric = keys.filter(k => /^MA\d+$/i.test(k)).sort();
                    const result = numeric.slice();
                    for (const label of MA_PROJECT_LEVELS) {
                        if (!result.includes(label)) result.push(label);
                    }
                    return result.length ? [...result, 'Other'] : ['Other'];
                }
                if (p === 'BA') {
                    const semesters = keys.filter(k => /^BA\d+$/i.test(k));
                    return semesters.length ? [...semesters, 'Other'] : ['Other'];
                }
                return ['Other'];
            }
        },
        {
            key: 'major',
            question: 'Which major?',
            getOptions: (formData) => {
                if (!programsTree) return [];
                const p = formData.program;
                if (!p) return [];
                if (p === 'PhD') {
                    const list = Array.isArray(programsTree.PhD?.edoc) ? programsTree.PhD.edoc : [];
                    return list.length ? [...list, 'Other'] : ['Other'];
                }
                const sem = formData.semester;
                if (!sem || !programsTree[p]) return [];
                const bucket = programsTree[p];
                const list = Array.isArray(bucket?.[sem]) ? bucket[sem] : [];
                return list.length ? [...list, 'Other'] : ['Other'];
            }
        },
        {
            key: 'minor',
            question: 'Which minor?',
            getOptions: (formData) => {
                if (!programsTree) return [];
                if (shouldSkipMinorQuestion(formData.program, formData.semester)) return [];
                const sem = formData.semester || '';
                const autumn = Array.isArray(programsTree.MA?.['Minor Autumn Semester']) ? programsTree.MA['Minor Autumn Semester'] : [];
                const spring = Array.isArray(programsTree.MA?.['Minor Spring Semester']) ? programsTree.MA['Minor Spring Semester'] : [];
                const season = inferMinorSeasonLabel(formData.program, sem);
                let list = [];
                if (season === 'Minor Autumn Semester') {
                    list = autumn;
                } else if (season === 'Minor Spring Semester') {
                    list = spring;
                } else {
                    const set = new Set([...autumn, ...spring]);
                    list = [...set];
                }
                return list.length ? [...list, 'Other'] : ['Other'];
            }
        }
    ];

    const handleAnswer = (value) => {
        const key = allQuestions[currentStep].key;
        const nextData = { ...formData, [key]: value };

        if (key === 'program' && value !== 'MA') {
            nextData.minor = '';
        }
        if (key === 'semester' && shouldSkipMinorQuestion(nextData.program, nextData.semester)) {
            nextData.minor = '';
        }

        setFormData(nextData);

        let nextStep = currentStep + 1;
        while (nextStep < allQuestions.length) {
            const nextKey = allQuestions[nextStep].key;
            if (nextKey === 'minor' && shouldSkipMinorQuestion(nextData.program, nextData.semester)) {
                nextStep += 1;
                continue;
            }
            break;
        }

        if (nextStep < allQuestions.length) {
            setCurrentStep(nextStep);
        } else {
            handleSubmit(nextData);
        }
    };

    // Compute if we can go back to a previous meaningful step (one that has options)
    const previousStepIndex = (() => {
        let idx = currentStep - 1;
        while (idx >= 0) {
            const opts = computeOptions(idx, formData, programsTree);
            if (Array.isArray(opts) && opts.length > 0) return idx;
            idx--;
        }
        return -1;
    })();
    const canGoBack = previousStepIndex >= 0;
    const goBack = () => {
        if (canGoBack) setCurrentStep(previousStepIndex);
    };

    // Auto-advance when options are empty; define this hook before any early return
    useEffect(() => {
        // Do nothing while loading tree
        if (!programsTree && !loadError) return;
        const opts = computeOptions(currentStep, formData, programsTree);
        if (Array.isArray(opts) && opts.length === 0) {
            // Skip this step with empty answer for this key
            handleAnswer('');
        }
    }, [currentStep, programsTree, loadError]);

    if (!programsTree && !loadError) {
        return (
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100vh',
                    width: '100vw',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                }}
            >
                <h2>Loading options…</h2>
            </div>
        );
    }
    if (loadError) {
        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100vh',
                    width: '100vw',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    gap: '12px',
                }}
            >
                <h2>Failed to load options</h2>
                <p>{String(loadError)}</p>
            </div>
        );
    }

    const q = allQuestions[currentStep];
    let options = [];
    if (q.getOptions) {
        options = q.getOptions(formData) || [];
    } else if (q.options) {
        options = q.options || [];
    }

    // (auto-advance handled by the earlier effect to keep Hooks order stable)

    return (
        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw', padding: '16px'}}>
            <div style={{
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                padding: '24px',
                borderRadius: 12,
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border-subtle)',
                boxShadow: 'var(--shadow-elevation)',
                minWidth: 'min(90vw, 420px)',
            }}>
                <h2>{q.question}</h2>
                {(q.key === 'major' || q.key === 'minor') ? (
                    <div style={{display: 'flex', flexDirection: 'row', gap: '10px', justifyContent: 'center', alignItems: 'center'}}>
                        <select
                            value={formData[q.key]}
                            onChange={(e) => setFormData(prev => ({ ...prev, [q.key]: e.target.value }))}
                        >
                            <option value="" disabled>Select an option</option>
                            {options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                        <button onClick={() => handleAnswer(formData[q.key])} disabled={!formData[q.key]}>Next</button>
                        <button onClick={goBack} disabled={!canGoBack}>Back</button>
                    </div>
                ) : (
                    <div style={{display: 'flex', flexDirection: 'row', gap: '10px', justifyContent: 'center', alignItems: 'center'}}>
                        {(() => {
                            const opts = options.includes('Other') ? options : [...options, 'Other'];
                            return opts.map(opt => (
                                <button key={opt} onClick={() => handleAnswer(opt)}>
                                    {opt}
                                </button>
                            ));
                        })()}
                        <button onClick={goBack} disabled={!canGoBack}>Back</button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Questionnaire;
