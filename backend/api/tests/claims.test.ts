import { describe, expect, it } from 'vitest';
import { principalFromClaims, claimsForPrincipal, CLAIM } from '../src/core/auth/claims.js';

const TENANT_CLAIM = `${'http://schemas.xmlsoap.org/ws/2005/05/identity/claims'}/spn`;
const USER_CLAIM = `${'http://schemas.xmlsoap.org/ws/2005/05/identity/claims'}/userdata`;

describe('principalFromClaims', () => {
  it('reads the long-form claim URIs minted by the .NET backend', () => {
    const principal = principalFromClaims({
      unique_name: 'admin',
      FullName: 'Demo Admin',
      [TENANT_CLAIM]: 'tenant1',
      [USER_CLAIM]: 'employee-1',
      role: 'Root',
    });
    expect(principal).toEqual({
      userName: 'admin',
      fullName: 'Demo Admin',
      tenantName: 'tenant1',
      employeeId: 'employee-1',
      roles: ['Root'],
      isRoot: true,
    });
  });

  it('reads the short claim aliases used on newly issued tokens', () => {
    const principal = principalFromClaims({
      unique_name: 'admin',
      FullName: 'Demo Admin',
      spn: 'tenant1',
      user_data: 'employee-1',
    });
    expect(principal?.tenantName).toBe('tenant1');
    expect(principal?.employeeId).toBe('employee-1');
    expect(principal?.isRoot).toBe(false);
  });

  it('rejects tokens without tenant or employee claims', () => {
    expect(principalFromClaims({ unique_name: 'admin' })).toBeUndefined();
    expect(principalFromClaims({ spn: 'tenant1' })).toBeUndefined();
  });

  it('collects roles from every accepted role claim name', () => {
    const principal = principalFromClaims({
      spn: 't',
      user_data: 'e',
      [CLAIM.role[1]]: 'Root',
    });
    expect(principal?.roles).toEqual(['Root']);
    expect(principal?.isRoot).toBe(true);
  });
});

describe('claimsForPrincipal', () => {
  it('omits the Root role for browser-facing tokens', () => {
    const bag = claimsForPrincipal({
      userName: 'admin',
      fullName: 'Demo Admin',
      tenantName: 'tenant1',
      employeeId: 'employee-1',
      publicUse: true,
    });
    expect(bag.role).toBeUndefined();
    expect(bag[TENANT_CLAIM]).toBe('tenant1');
    expect(bag[USER_CLAIM]).toBe('employee-1');
  });

  it('adds the Root role for server-side tokens', () => {
    const bag = claimsForPrincipal({
      userName: 'admin',
      fullName: 'Demo Admin',
      tenantName: 'tenant1',
      employeeId: 'employee-1',
      publicUse: false,
    });
    expect(bag.role).toBe('Root');
  });

  it('round-trips through principalFromClaims', () => {
    const input = {
      userName: 'admin',
      fullName: 'Demo Admin',
      tenantName: 'tenant1',
      employeeId: 'employee-1',
      publicUse: false,
    };
    expect(principalFromClaims(claimsForPrincipal(input))).toMatchObject({
      userName: input.userName,
      fullName: input.fullName,
      tenantName: input.tenantName,
      employeeId: input.employeeId,
      isRoot: true,
    });
  });
});
