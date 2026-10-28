package com.amber.openmusic;

import com.amber.security.AdminAuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/open-music")
public class OpenMusicImportController {
    private final OpenMusicImportService service;
    private final AdminAuthService adminAuthService;

    public OpenMusicImportController(OpenMusicImportService service, AdminAuthService adminAuthService) {
        this.service = service;
        this.adminAuthService = adminAuthService;
    }

    @GetMapping("/search")
    public List<JamendoTrackView> search(@RequestParam("q") String query,
                                         @RequestParam(defaultValue = "20") int limit) {
        return service.search(query, limit);
    }

    @PostMapping("/jobs")
    public ResponseEntity<OpenMusicImportJobView> createJob(@Valid @RequestBody CreateImportRequest body,
                                                             HttpServletRequest request) {
        adminAuthService.verifyAdminAccess(request);
        UUID jobId = service.createJob(body.trackIds());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(service.getJob(jobId));
    }

    @GetMapping("/jobs/active")
    public List<OpenMusicImportJobView> getActiveJobs(HttpServletRequest request) {
        adminAuthService.verifyAdminAccess(request);
        return service.getActiveJobs();
    }

    @GetMapping("/jobs/{id}")
    public OpenMusicImportJobView getJob(@PathVariable UUID id, HttpServletRequest request) {
        adminAuthService.verifyAdminAccess(request);
        return service.getJob(id);
    }

    @PostMapping("/jobs/{id}/retry-failed")
    public OpenMusicImportJobView retryFailed(@PathVariable UUID id, HttpServletRequest request) {
        adminAuthService.verifyAdminAccess(request);
        return service.retryFailed(id);
    }

    @PostMapping("/jobs/{id}/cancel")
    public OpenMusicImportJobView cancel(@PathVariable UUID id, HttpServletRequest request) {
        adminAuthService.verifyAdminAccess(request);
        return service.cancel(id);
    }

    public record CreateImportRequest(@NotEmpty @Size(max = 25) List<@Size(min = 1, max = 20) String> trackIds) {}
}
