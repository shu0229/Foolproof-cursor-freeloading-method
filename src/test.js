import fetch from 'node-fetch';

async function testTokenLatency(token) {
    const startTime = Date.now();
    
    try {
        const response = await fetch('http://localhost:3010/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20241022',
                messages: [
                    {
                        role: 'user',
                        content: '123'
                    }
                ],
                stream: false
            })
        });

        const data = await response.json();
        const endTime = Date.now();
        const latency = endTime - startTime;

        if (data.error) {
            return { token, latency: -1, error: data.error };
        }

        return { token, latency, success: true };
    } catch (error) {
        return { token, latency: -1, error: error.message };
    }
}

export { testTokenLatency }; 