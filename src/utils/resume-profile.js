/** Shared normalization for imported resume data and the profile editor. */
(() => {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const ongoing = value => /^(present|current|currently|ongoing|to date|now)$/i.test(String(value || '').trim());
    function date(value) {
        if (typeof value !== 'string') return '';
        const text = value.trim();
        let parts = text.match(/^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?$/);
        if (!parts) {
            const numeric = text.match(/^(\d{1,2})[/-](\d{4})$/);
            const named = text.match(/^([a-z]+)[.,\s]+(\d{4})$/i);
            const reverse = text.match(/^(\d{4})[.,\s]+([a-z]+)$/i);
            if (numeric) parts = ['',numeric[2],numeric[1]];
            else if (named || reverse) {
                const month = months.indexOf((named?.[1] || reverse[2]).slice(0,3).toLowerCase()) + 1;
                if (!month) return '';
                parts = ['',named?.[2] || reverse[1],String(month)];
            } else return '';
        }
        const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
        if (year < 1000 || year > 9999) return '';
        if (!parts[2]) return parts[1];
        if (month < 1 || month > 12) return '';
        const ym = `${parts[1]}-${String(month).padStart(2,'0')}`;
        if (!parts[3]) return ym;
        if (day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate()) return '';
        return `${ym}-${String(day).padStart(2,'0')}`;
    }
    function text(value) {
        if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n');
        return typeof value === 'string' ? value.trim() : '';
    }
    function experience(entry) {
        const result = {...entry};
        const description = text(entry.description || entry.roleDescription);
        const bullets = [entry.responsibilities,entry.achievements].flatMap(value =>
            Array.isArray(value) ? value.map(text) : text(value) ? [text(value)] : []);
        const existingLines = new Set(description.split('\n').map(line=>line.replace(/^[\s•*\-]+/,'').trim()));
        const lines = description ? [description] : [];
        for (const bullet of bullets) {
            const clean = bullet.replace(/^[\s•*\-]+/,'').trim();
            if (clean && !existingLines.has(clean) && !description.includes(clean)) {
                lines.push(`• ${clean}`);
                existingLines.add(clean);
            }
        }
        result.description = lines.join('\n');
        result.startDate = date(entry.startDate);
        result.endDate = date(entry.endDate);
        // A missing end date alone doesn't imply ongoing employment.
        result.current = entry.current === true || /^(true|yes)$/i.test(String(entry.current)) || ongoing(entry.endDate);
        if (result.current) result.endDate = '';
        return result;
    }
    function profile(data) {
        return {...data,
            experience: Array.isArray(data.experience) ? data.experience.filter(e=>e && typeof e === 'object').map(experience) : [],
            education: Array.isArray(data.education) ? data.education.filter(e=>e && typeof e === 'object').map(e=>({...e,startDate:date(e.startDate),endDate:date(e.endDate)})) : []
        };
    }
    function pdfText(items) {
        return items.map((item,index) => {
            const next = items[index + 1];
            const newLine = item.hasEOL || (next?.transform && item.transform && Math.abs(next.transform[5]-item.transform[5]) > 3);
            return item.str + (newLine ? '\n' : ' ');
        }).join('');
    }
    globalThis.ResumeProfile = {date, experience, profile, pdfText};
})();
