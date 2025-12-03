// NOTE: Place studyplans_tree.json under client/public/ so it is served at /studyplans_tree.json
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
function GuidedSearch() {
    const navigate = useNavigate();
    const [showIntro, setShowIntro] = useState(true);
    const [programsTree, setProgramsTree] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [currentStep, setCurrentStep] = useState(0);
    const [selectedCycle, setSelectedCycle] = useState('');

    useEffect(() => {
        async function loadTree() {
            try {
                // studyplans_tree.json must be placed under client/public
                const res = await fetch('/studyplans_tree.json', { cache: 'no-store' });
                if (!res.ok) throw new Error(`Failed to fetch studyplans_tree.json: ${res.status}`);
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

    const handleCycleSelect = (value) => {
        setSelectedCycle(value);
        setCurrentStep(1);
    };

    const handlePlanSelect = (planName) => {
        if (!selectedCycle || !planName) return;
        const params = new URLSearchParams();
        params.set('study_program', selectedCycle);
        params.set('study_plan', planName);
        navigate(`/courses?${params.toString()}`);
    };

    const cycleOptions = Object.keys(programsTree || {});
    const planOptions = selectedCycle && programsTree
        ? (Array.isArray(programsTree[selectedCycle]) ? programsTree[selectedCycle] : [])
        : [];

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

    const isCycleStep = currentStep === 0;
    const question = isCycleStep
        ? 'Which study cycle are you interested in?'
        : `Choose a study plan in ${selectedCycle}`;
    const options = isCycleStep ? cycleOptions : planOptions;

    const handleBack = () => {
        if (isCycleStep) {
            navigate('/courses');
            return;
        }
        setCurrentStep(0);
        setSelectedCycle('');
    };

    const handleSkip = () => navigate('/courses');

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', width: '100%', padding: '40px 16px' }}>
            <div
                style={{
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    padding: '0 12px',
                    color: 'var(--color-text)',
                    maxWidth: '560px',
                    width: '100%',
                }}
            >
                <h2 style={{ margin: '0 0 0.5rem' }}>{question}</h2>
                {options.length === 0 && (
                    <p style={{ color: 'var(--color-text-muted)' }}>
                        {isCycleStep ? 'No study cycles available.' : 'No study plans under this cycle.'}
                    </p>
                )}
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                    {options.map((option) => (
                        <button
                            key={option}
                            onClick={() => (isCycleStep ? handleCycleSelect(option) : handlePlanSelect(option))}
                            style={{
                                padding: '12px 16px',
                                borderRadius: 10,
                                border: '1px solid var(--color-border-subtle)',
                                background: 'var(--color-surface)',
                                color: 'var(--color-text)',
                                cursor: 'pointer',
                                boxShadow: 'var(--shadow-elevation)',
                            }}
                        >
                            {option}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
                    <button onClick={handleBack}>
                        {isCycleStep ? 'Skip' : 'Back'}
                    </button>
                    <button onClick={handleSkip}>
                        Skip guided search
                    </button>
                </div>
            </div>
        </div>
    );
}

export default GuidedSearch;
