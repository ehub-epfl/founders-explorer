// NOTE: Place programs_tree.json under client/public/ so it is served at /programs_tree.json
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MA_PROJECT_LEVELS,
    inferMinorSeasonLabel,
    inferSemesterFromLevel,
    shouldSkipMinorQuestion,
} from '../utils/levels';

function GuidedSearch() {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(0);
    const [showIntro, setShowIntro] = useState(true);
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
        const studyProgram = (data.program || '').trim();
        const studyPlan = (data.semester || '').trim();
        const major = (data.major || '').trim();
        const minor = (data.minor || '').trim();
        const inferredSemester = inferSemesterFromLevel(studyPlan);

        const params = new URLSearchParams();
        if (studyProgram) params.set('study_program', studyProgram);
        if (studyPlan) params.set('study_plan', studyPlan);
        if (major) params.set('major', major);
        if (studyProgram === 'MA' && minor) params.set('minor', minor);
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
                    return base;
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
                    return result;
                    }
                    if (p === 'BA') {
                        const semesters = keys.filter(k => /^BA\d+$/i.test(k));
                    return semesters;
                }
                return [];
                }
            },
            {
                key: 'major',
                get: () => {
                    const p = data.program;
                    if (!p) return [];
                    if (p === 'PhD') {
                        const list = Array.isArray(tree.PhD?.edoc) ? tree.PhD.edoc : [];
                        return list;
                    }
                    const sem = data.semester;
                    if (!sem || !tree[p]) return [];
                    const bucket = tree[p];
                    const list = Array.isArray(bucket?.[sem]) ? bucket[sem] : [];
                    return list;
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
                    return list;
                }
            }
        ][stepIndex];
        return step ? step.get() : [];
    };

    const allQuestions = [
        {
            key: 'program',
            question: 'Which program are you in?',
            getOptions: () => Object.keys(programsTree || {}),
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
                    return result;
                }
                if (p === 'BA') {
                    const semesters = keys.filter(k => /^BA\d+$/i.test(k));
                    return semesters;
                }
                return [];
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
                    const list = Array.isArray(programsTree.PhD?.['Doctoral School']) ? programsTree.PhD['Doctoral School'] : [];
                    return list;
                }
                const sem = formData.semester;
                if (!sem || !programsTree[p]) return [];
                const bucket = programsTree[p];
                const list = Array.isArray(bucket?.[sem]) ? bucket[sem] : [];
                return list;
            }
        },
        {
            key: 'minor',
            question: 'Which minor?',
            getOptions: (formData) => {
                if (!programsTree) return [];
                if (formData.program === 'PhD') return [];
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
                return list;
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
        // Do nothing while loading tree or while the intro screen is visible
        if (showIntro || (!programsTree && !loadError)) return;
        const opts = computeOptions(currentStep, formData, programsTree);
        if (Array.isArray(opts) && opts.length === 0) {
            // Skip this step with empty answer for this key
            handleAnswer('');
        }
    }, [currentStep, programsTree, loadError, showIntro]);

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

    if (showIntro) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '70vh',
                padding: '48px 16px',
                textAlign: 'center',
                gap: '24px',
            }}>
                <div style={{ maxWidth: 560 }}>
                    <h1 style={{ marginBottom: '0.75rem', fontSize: '2rem' }}>Guided Search</h1>
                    <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-text-muted, #4b5563)' }}>
                        Answer a few quick questions and we’ll prefill the course filters for you.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                        type="button"
                        onClick={() => navigate('/courses')}
                        style={{
                            padding: '10px 18px',
                            borderRadius: 6,
                            border: '1px solid var(--color-border, #d1d5db)',
                            background: 'var(--color-surface, #fff)',
                            color: 'var(--color-text, #111827)',
                            cursor: 'pointer',
                        }}
                    >
                        Skip
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowIntro(false)}
                        style={{
                            padding: '10px 18px',
                            borderRadius: 6,
                            border: '1px solid var(--color-primary, #2563eb)',
                            background: 'var(--color-primary, #2563eb)',
                            color: 'var(--color-primary-contrast, #fff)',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Continue
                    </button>
                </div>
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
        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', width: '100%', padding: '40px 16px'}}>
            <div style={{
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                padding: '0 12px',
                color: 'var(--color-text)',
                maxWidth: '520px',
                width: '100%',
            }}>
                <h2 style={{ margin: '0 0 0.5rem' }}>{q.question}</h2>
                {(q.key === 'major' || q.key === 'minor') ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                        <select
                            value={formData[q.key]}
                            onChange={(e) => setFormData(prev => ({ ...prev, [q.key]: e.target.value }))}
                            disabled={q.key !== 'major' && formData.program === 'PhD'}
                        >
                            <option value="" disabled>Select an option</option>
                            {options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                            <button onClick={goBack} disabled={!canGoBack}>Back</button>
                            <button onClick={() => handleAnswer(formData[q.key])} disabled={!formData[q.key]}>Next</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                            {options.map(opt => (
                                <button key={opt} onClick={() => handleAnswer(opt)}>
                                    {opt}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
                            <button onClick={goBack} disabled={!canGoBack}>Back</button>
                            <button onClick={() => handleAnswer('')}>Skip</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default GuidedSearch;
