class IngressStateSimulator {
    constructor(portalsList) {
        this.portalStates = new Map(); 
        this.links = new Set();        
        this.fields = [];              

        portalsList.forEach(p => {
            this.portalStates.set(p.id, { 
                id: p.id, lat: p.lat, lng: p.lng, 
                team: 'NEUTRAL'
            });
        });
    }

    getLinkKey(id1, id2) {
        return [id1, id2].sort().join('-');
    }

    processAction(action) {
        const p1Id = action.portal_id;
        const p2Id = action.target_portal_id;
        
        // EXTRACT TEAM
        let team = null;
        if (action.action.includes('_RES')) team = 'RES';
        else if (action.action.includes('_ENL')) team = 'ENL';

        // PORTAL OWNERSHIP LOGIC
        // "captured", "deploy", "link" all imply the portal belongs to that team.
        if (team && p1Id) {
            if (action.action.includes('captured') || action.action.includes('deploy') || action.action.includes('link')) {
                this.setPortalTeam(p1Id, team);
            }
        }
        
        // ACTION SPECIFIC LOGIC

        // -- DESTROY --
        if (action.action === 'destroy' && action.type === 'portal') {
            this.setPortalTeam(p1Id, 'NEUTRAL');
            this.removeLinksAttachedTo(p1Id);
        }
        
        // -- LINK --
        else if (action.type === 'link') {
            if (p1Id && p2Id && team) {
                // Ensure both ends are painted (sometimes data is missing for one end)
                this.setPortalTeam(p1Id, team);
                this.setPortalTeam(p2Id, team);
                
                this.links.add(this.getLinkKey(p1Id, p2Id));
            }
        }

        // -- FIELD --
        else if (action.type === 'field') {
            // A field closes a triangle based on existing links
            const triangle = this.findTriangle(p1Id);
            if (triangle && team) {
                this.fields.push({ ...triangle, team: team });
            }
        }
        
        // -- BATTLE BEACON --
        else if (action.action.startsWith('won_')) {
            // Winning a beacon paints the portal
            this.setPortalTeam(p1Id, team);
        }
    }

    setPortalTeam(id, team) {
        if (this.portalStates.has(id)) {
            // Actually, just set it.
            this.portalStates.get(id).team = team;
        }
    }

    removeLinksAttachedTo(id) {
        // Remove links
        for (const linkKey of this.links) {
            if (linkKey.includes(id)) this.links.delete(linkKey);
        }
        // Remove fields
        this.fields = this.fields.filter(f => f.p1 !== id && f.p2 !== id && f.p3 !== id);
    }

    findTriangle(anchorId) {
        const neighbors = [];
        for (const linkKey of this.links) {
            if (linkKey.includes(anchorId)) {
                const parts = linkKey.split('-');
                neighbors.push(parts[0] === anchorId ? parts[1] : parts[0]);
            }
        }
        for (let i = 0; i < neighbors.length; i++) {
            for (let j = i + 1; j < neighbors.length; j++) {
                const n1 = neighbors[i];
                const n2 = neighbors[j];
                const key = this.getLinkKey(n1, n2);
                if (this.links.has(key)) return { p1: anchorId, p2: n1, p3: n2 };
            }
        }
        return null;
    }

    getCurrentState() {
        return {
            portals: Array.from(this.portalStates.values()),
            links: Array.from(this.links).map(k => {
                const [a, b] = k.split('-');
                return { p1: a, p2: b };
            }),
            fields: this.fields
        };
    }
}

module.exports = IngressStateSimulator;