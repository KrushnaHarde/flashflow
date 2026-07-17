package com.krushna.flashflow.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtService jwtService;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        final String authHeader = request.getHeader("Authorization");
        final String jwt;
        final String userEmail;
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            filterChain.doFilter(request, response);
            return;
        }
        jwt = authHeader.substring(7);
        try {
            userEmail = jwtService.extractUsername(jwt);
            if (userEmail != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                String roleStr = jwtService.extractClaim(jwt, claims -> claims.get("role", String.class));
                com.krushna.flashflow.auth.Role role = com.krushna.flashflow.auth.Role.USER;
                if (roleStr != null) {
                    try {
                        role = com.krushna.flashflow.auth.Role.valueOf(roleStr);
                    } catch (Exception e) {
                        // fallback
                    }
                }
                
                String userIdStr = jwtService.extractClaim(jwt, claims -> claims.get("userId", String.class));
                java.util.UUID userId = null;
                if (userIdStr != null) {
                    try {
                        userId = java.util.UUID.fromString(userIdStr);
                    } catch (Exception e) {
                        // fallback
                    }
                }
                
                String name = jwtService.extractClaim(jwt, claims -> claims.get("name", String.class));
                if (name == null) {
                    name = "Lightweight User";
                }
                
                com.krushna.flashflow.user.User userDetails = com.krushna.flashflow.user.User.builder()
                        .userId(userId)
                        .email(userEmail)
                        .name(name)
                        .role(role)
                        .enabled(true)
                        .password("")
                        .build();

                if (jwtService.isTokenValid(jwt, userDetails.getUsername())) {
                    UsernamePasswordAuthenticationToken authToken = new UsernamePasswordAuthenticationToken(
                            userDetails,
                            null,
                            userDetails.getAuthorities()
                    );
                    authToken.setDetails(
                            new WebAuthenticationDetailsSource().buildDetails(request)
                    );
                    SecurityContextHolder.getContext().setAuthentication(authToken);
                }
            }
        } catch (Exception e) {
            // If token is invalid or expired, do not set the security context.
            // Spring Security will automatically handle unauthorized access for secured endpoints.
        }
        filterChain.doFilter(request, response);
    }
}
